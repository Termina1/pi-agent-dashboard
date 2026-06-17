// ---------------------------------------------------------------------------
// useImagePaste — reusable clipboard-image-paste state + handler.
//
// Supports two modes:
//
//   1. Uncontrolled (legacy): `useImagePaste()` with no args. The hook
//      owns `pendingImages` in local `useState`. Used by the OpenSpec
//      Explore dialog — its lifetime IS the dialog's lifetime, so a
//      per-component state location is correct.
//
//   2. Controlled: `useImagePaste({ images, onImagesChange })`. The
//      caller owns the array and gets a setter. Used by `<CommandInput>`
//      so pending images can be lifted to App-level state keyed by
//      sessionId — surviving route changes (Settings, terminals,
//      OpenSpec preview, …) and not leaking across session switches.
//
// Behavior (identical in both modes):
//   - Supported MIME types: image/jpeg, image/png, image/gif, image/webp
//   - Max size: 10 MB of base64 (≈7.5 MB of raw bytes)
//   - On unsupported/oversized paste: set `imageError` for 3 s, ignore the blob
//   - On successful paste: append to `pendingImages`
//   - `clearImages()` is meant to be called by the consumer after sending
//     so the UI resets.
//
// `imageError` is local in BOTH modes — it auto-clears after 3 s and
// has no value in surviving an unmount. Lifting it would force the
// caller to manage a clear timeout for no user-visible benefit.
//
// The returned `handlePaste` swallows the clipboard event with
// preventDefault when an image is handled, preventing the base64 data
// URL from being inserted as text into the textarea.
// ---------------------------------------------------------------------------

import { useCallback, useState } from "react";
import type { ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB base64
export const SUPPORTED_IMAGE_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
]);

export interface UseImagePasteOptions {
	/** When provided, the hook is controlled — caller owns the array. */
	images?: ImageContent[];
	/** Called whenever the images array would change. Required when `images` is provided. */
	onImagesChange?: (next: ImageContent[]) => void;
}

export interface UseImagePasteResult {
	/** Accumulated pasted images ready to attach to a send_prompt. */
	pendingImages: ImageContent[];
	/** Transient error message; auto-clears after 3s. null when idle. */
	imageError: string | null;
	/** Clipboard paste handler — attach to the textarea's onPaste. */
	handlePaste: (e: React.ClipboardEvent) => void;
	/** Add files from a file-picker or drag-and-drop. Validates each. */
	addFiles: (files: File[] | FileList) => void;
	/** Remove the image at index `i` from pendingImages. */
	removeImage: (index: number) => void;
	/** Clear everything — call after a successful send. */
	clearImages: () => void;
}

/**
 * Read a single File into an `ImageContent`, validating MIME + size.
 * Resolves to `{ ok, image }` on success or `{ ok: false, error }` on
 * rejection (unsupported type / too large / unreadable). Pure aside from
 * the FileReader read — shared by paste, file-picker, and drag-and-drop.
 */
export function readImageFile(file: File): Promise<{ ok: true; image: ImageContent } | { ok: false; error: string }> {
	const mimeType = file.type;
	if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
		return Promise.resolve({
			ok: false,
			error: `Unsupported image type: ${mimeType || file.name}. Use JPEG, PNG, GIF, or WebP.`,
		});
	}
	return new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = () => {
			const dataUrl = reader.result as string;
			const base64 = dataUrl.split(",")[1];
			if (!base64) {
				resolve({ ok: false, error: `Could not read image: ${file.name}` });
				return;
			}
			if (base64.length > MAX_IMAGE_SIZE) {
				resolve({ ok: false, error: `Image too large (max 10MB): ${file.name}` });
				return;
			}
			resolve({ ok: true, image: { type: "image", data: base64, mimeType } });
		};
		reader.onerror = () => resolve({ ok: false, error: `Could not read image: ${file.name}` });
		reader.readAsDataURL(file);
	});
}

export function useImagePaste(opts?: UseImagePasteOptions): UseImagePasteResult {
	const isControlled = opts?.images !== undefined;
	const [localImages, setLocalImages] = useState<ImageContent[]>([]);
	const [imageError, setImageError] = useState<string | null>(null);

	// Source of truth for the current array.
	const pendingImages = isControlled ? (opts!.images as ImageContent[]) : localImages;

	// Setter that routes through the caller in controlled mode and through
	// local state otherwise. Accepts a value or an updater function so call
	// sites can use either.
	const writeImages = useCallback(
		(next: ImageContent[] | ((prev: ImageContent[]) => ImageContent[])) => {
			if (isControlled) {
				const onChange = opts?.onImagesChange;
				if (!onChange) return;
				const resolved =
					typeof next === "function"
						? (next as (p: ImageContent[]) => ImageContent[])(opts!.images as ImageContent[])
						: next;
				onChange(resolved);
			} else {
				setLocalImages(next as ImageContent[] | ((p: ImageContent[]) => ImageContent[]));
			}
		},
		[isControlled, opts],
	);

	const setError = useCallback((msg: string) => {
		setImageError(msg);
		setTimeout(() => setImageError(null), 3000);
	}, []);

	const addFiles = useCallback((files: File[] | FileList) => {
		const list = Array.from(files);
		if (list.length === 0) return;
		let syncError: string | null = null;
		// Fast-reject unsupported types synchronously so the error surfaces in
		// the same tick as the input (matches the original paste contract).
		const accepted = list.filter((f) => {
			if (SUPPORTED_IMAGE_TYPES.has(f.type)) return true;
			if (syncError === null) {
				syncError = `Unsupported image type: ${f.type || f.name}. Use JPEG, PNG, GIF, or WebP.`;
			}
			return false;
		});
		if (syncError) setError(syncError);
		if (accepted.length === 0) return;
		let pending: ImageContent[] = [];
		let firstError: string | null = null;
		let remaining = accepted.length;
		const finish = () => {
			remaining--;
			if (remaining > 0) return;
			if (pending.length > 0) {
				writeImages((prev) => [...prev, ...pending]);
			}
			if (firstError) setError(firstError);
		};
		for (const file of accepted) {
			readImageFile(file).then((r) => {
				if (r.ok) {
					pending.push(r.image);
				} else if (firstError === null) {
					firstError = r.error;
				}
				finish();
			});
		}
	}, [writeImages, setError]);

	const handlePaste = useCallback((e: React.ClipboardEvent) => {
		const items = e.clipboardData.items;
		const files: File[] = [];
		for (const item of items) {
			if (!item.type.startsWith("image/")) continue;
			const blob = item.getAsFile();
			if (blob) files.push(blob);
		}
		if (files.length === 0) return;
		// Swallow the clipboard event so the base64 data URL is not inserted
		// as text into the textarea.
		e.preventDefault();
		addFiles(files);
	}, [addFiles]);

	const removeImage = useCallback((index: number) => {
		writeImages((prev) => prev.filter((_, i) => i !== index));
	}, [writeImages]);

	const clearImages = useCallback(() => {
		writeImages([]);
		setImageError(null);
	}, [writeImages]);

	return { pendingImages, imageError, handlePaste, addFiles, removeImage, clearImages };
}
