/**
 * `show_image` tool registration for the bridge extension.
 *
 * Lets an agent display an image inline in the dashboard chat — a clean,
 * tool-based alternative to invoking `read` on an image file or embedding
 * raw markdown `![](path)` (which the inliner already supports but which
 * the model must compose by hand).
 *
 * Design:
 *   - The model passes ONLY a local file `path` (cheap in output tokens —
 *     no base64 ever leaves the model). Optional `caption` + `alt`.
 *   - The bridge reads the file, hashes the bytes (reusing the markdown
 *     inliner's primitives so caps / MIME allowlist / hashing are
 *     identical), emits an `asset_register` for any newly-seen hash, and
 *     returns `{ details: { hash, caption, alt, mimeType, path } }`.
 *   - The dashboard `ShowImageToolRenderer` resolves `pi-asset:<hash>`
 *     via `useSessionAssets()` and renders a large `<figure>` with the
 *     image + caption + lightbox — on web and mobile.
 *
 * The core resolver `resolveShowImageAsset` is **pure** (all I/O via the
 * injected `readFile` callback) so every branch is unit-testable with
 * memory fixtures, mirroring `inlineMessageText`'s design.
 *
 * See change: add-show-image-tool.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { statSync, readFileSync } from "node:fs";
import {
	resolveLocalPath,
	mimeFromExtension,
	hashBytes,
	MAX_PER_IMAGE_BYTES,
	type ReadFileOutcome,
} from "./markdown-image-inliner.js";

/** MIME allowlist (mirrors the markdown inliner's extension map). */
const ALLOWED_MIMES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/svg+xml",
	"image/avif",
	"image/bmp",
]);

/** True for http(s) URLs (remote images fetched bridge-side). */
export function isHttpUrl(s: string): boolean {
	return s.startsWith("http://") || s.startsWith("https://");
}

/** True for `data:` URLs (inline base64 / URL-encoded image bytes). */
export function isDataUrl(s: string): boolean {
	return s.startsWith("data:");
}

/** Minimal fetch shape the remote resolver needs (Node 18+ global fetch fits). */
export type FetchLike = (input: string) => Promise<{
	ok: boolean;
	status: number;
	arrayBuffer: () => Promise<ArrayBuffer>;
	headers: { get(name: string): string | null };
}>;

/**
 * Default synchronous fs probe + read (mirrors the bridge's `inlinerReadFile`).
 * Used only when no `readFile` dep is injected; the bridge always injects its
 * own closure so this is a pure fallback for ad-hoc callers.
 */
function defaultReadFile(absolutePath: string): ReadFileOutcome {
	try {
		const st = statSync(absolutePath);
		if (st.isDirectory()) return { ok: false, kind: "EISDIR" };
		if (!st.isFile()) return { ok: false, kind: "EOTHER" };
		return { ok: true, bytes: readFileSync(absolutePath) };
	} catch (err: any) {
		const code = err?.code;
		if (code === "ENOENT") return { ok: false, kind: "ENOENT" };
		if (code === "EACCES") return { ok: false, kind: "EACCES" };
		if (code === "EISDIR") return { ok: false, kind: "EISDIR" };
		return { ok: false, kind: "EOTHER" };
	}
}

/** Visible result kinds for the pure resolver. */
export type ShowImageOutcome =
	| { ok: true; hash: string; mimeType: string; data: string; alreadyEmitted: boolean }
	| { ok: false; reason: "not_found" | "read_failed" | "unsupported_type" | "too_large"; message: string };

export interface ResolveShowImageOptions {
	/** Synchronous file-read callback (same contract as the markdown inliner). */
	readFile: (absolutePath: string) => ReadFileOutcome;
	/** Working directory used to resolve relative `path`s. */
	cwd: string;
	/** Per-session set of hashes already shipped via `asset_register`. */
	alreadyEmitted: Set<string>;
	/** Override the per-image cap. Default `MAX_PER_IMAGE_BYTES`. */
	maxPerImageBytes?: number;
}

/**
 * Pure resolver: reads the file, validates MIME/size, and returns either a
 * ready-to-emit asset (hash + base64 + whether bytes are new) or a
 * user-facing failure reason. Mirrors the inliner's failure taxonomy so the
 * dashboard placeholders read identically.
 */
export function resolveShowImageAsset(
	rawPath: string,
	opts: ResolveShowImageOptions,
): ShowImageOutcome {
	const absPath = resolveLocalPath(rawPath, opts.cwd);

	const outcome = opts.readFile(absPath);
	if (!outcome.ok) {
		if (outcome.kind === "ENOENT" || outcome.kind === "EACCES") {
			return { ok: false, reason: "not_found", message: `image not found: ${rawPath}` };
		}
		return { ok: false, reason: "read_failed", message: `image read failed: ${rawPath}` };
	}

	const mime = mimeFromExtension(absPath);
	return assetFromBytes(outcome.bytes, mime, rawPath, opts);
}

/**
 * Shared bytes → asset step: hash, dedup-check against `alreadyEmitted`, and
 * apply the per-image size cap to NEW emissions only (already-registered
 * assets bypass — bytes were paid for on the previous emission). Returns
 * `null` MIME → `unsupported_type` so callers can derive MIME from any
 * source (file ext / Content-Type / data: prefix) and delegate validation.
 */
function assetFromBytes(
	bytes: Buffer,
	mimeType: string | null,
	rawSrc: string,
	opts: { alreadyEmitted: Set<string>; maxPerImageBytes?: number },
): ShowImageOutcome {
	if (!mimeType || !ALLOWED_MIMES.has(mimeType)) {
		return { ok: false, reason: "unsupported_type", message: `unsupported image type: ${rawSrc}` };
	}
	const hash = hashBytes(bytes);
	const alreadyEmitted = opts.alreadyEmitted.has(hash);
	if (!alreadyEmitted) {
		const max = opts.maxPerImageBytes ?? MAX_PER_IMAGE_BYTES;
		if (bytes.length > max) {
			const mb = (bytes.length / (1024 * 1024)).toFixed(1);
			return { ok: false, reason: "too_large", message: `image too large: ${rawSrc} (${mb} MB)` };
		}
	}
	return {
		ok: true,
		hash,
		mimeType,
		data: bytes.toString("base64"),
		alreadyEmitted,
	};
}

export interface ResolveRemoteImageOptions {
	/** Per-session set of hashes already shipped via `asset_register`. */
	alreadyEmitted: Set<string>;
	/** Override fetch (tests inject a stub; production uses global fetch). */
	fetchImpl?: FetchLike;
	/** Override the per-image cap. Default `MAX_PER_IMAGE_BYTES`. */
	maxPerImageBytes?: number;
}

/**
 * Async resolver for http(s) URLs: fetches the bytes, derives MIME from
 * Content-Type (falling back to the URL path extension), validates against
 * the allowlist, then funnels through `assetFromBytes`. Network errors and
 * non-2xx map to `not_found` so the model sees a clear retry-able reason.
 */
export async function resolveRemoteImageAsset(
	url: string,
	opts: ResolveRemoteImageOptions,
): Promise<ShowImageOutcome> {
	const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
	if (!fetchImpl) {
		return { ok: false, reason: "read_failed", message: `fetch unavailable: ${url}` };
	}
	let resp;
	try {
		resp = await fetchImpl(url);
	} catch {
		return { ok: false, reason: "not_found", message: `image fetch failed: ${url}` };
	}
	if (!resp.ok) {
		return { ok: false, reason: "not_found", message: `image fetch failed (${resp.status}): ${url}` };
	}
	let bytes: Buffer;
	try {
		bytes = Buffer.from(await resp.arrayBuffer());
	} catch {
		return { ok: false, reason: "read_failed", message: `image read failed: ${url}` };
	}
	// Prefer Content-Type; fall back to the URL path extension.
	let mime: string | null = null;
	const ct = resp.headers.get("content-type");
	if (ct) mime = ct.split(";")[0]!.trim().toLowerCase() || null;
	if (!mime || !ALLOWED_MIMES.has(mime)) {
		try {
			mime = mimeFromExtension(new URL(url).pathname) ?? null;
		} catch {
			mime = null;
		}
	}
	return assetFromBytes(bytes, mime, url, opts);
}

/**
 * Resolver for `data:` URLs: parses `data:<mime>;base64,<payload>` (or the
 * URL-encoded form), validates MIME, decodes bytes, funnels through
 * `assetFromBytes`. No I/O.
 */
export function resolveDataUrlAsset(
	dataUrl: string,
	opts: { alreadyEmitted: Set<string>; maxPerImageBytes?: number },
): ShowImageOutcome {
	// data:[<mediatype>][;base64],<data>
	const commaIdx = dataUrl.indexOf(",");
	if (commaIdx === -1) {
		return { ok: false, reason: "read_failed", message: `malformed data URL` };
	}
	const meta = dataUrl.slice("data:".length, commaIdx); // e.g. image/png;base64
	const payload = dataUrl.slice(commaIdx + 1);
	const isBase64 = meta.includes(";base64");
	const mime = meta.split(";")[0] || null;
	let bytes: Buffer;
	try {
		bytes = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload));
	} catch {
		return { ok: false, reason: "read_failed", message: `malformed data URL` };
	}
	return assetFromBytes(bytes, mime, dataUrl, opts);
}

/** Dependencies the bridge injects so the tool can emit assets + track state. */
export interface ShowImageToolDeps {
	/** Send a message on the bridge WebSocket (used for `asset_register`). */
	send: (msg: unknown) => void;
	/** Per-session already-emitted hash set. */
	getEmittedAssetHashes: (sessionId: string) => Set<string>;
	/** Current session id. */
	getSessionId: () => string;
	/** Current working directory (live cwd, falls back to process.cwd()). */
	getCwd: () => string;
	/** Override for tests; bridge wires `node:fs` via the inliner's helper. */
	readFile?: (absolutePath: string) => ReadFileOutcome;
	/** Override fetch for tests; production uses Node 18+ global fetch. */
	fetchImpl?: FetchLike;
}

/**
 * Register the `show_image` tool. Idempotent within a process (guarded by
 * `toolRegistered`) so re-registration on session switches is a no-op —
 * matching `registerPushNotifyUserTool`.
 */
let toolRegistered = false;
export function registerShowImageTool(pi: ExtensionAPI, deps: ShowImageToolDeps): void {
	if (toolRegistered) return;
	toolRegistered = true;

	pi.registerTool({
		name: "show_image",
		label: "Show Image",
		description: [
			"Display an image inline in the dashboard chat for the user.",
			"",
			"Use this tool — NOT the read tool and NOT raw markdown — when you want to SHOW an image to the user:",
			"- screenshots you created (e.g. via browser automation or a sandbox)",
			"- generated images / logos / mockups you wrote to disk",
			"- any local image file the user should see",
			"- a REMOTE image URL (https://...) — the dashboard downloads it and shows it from its own asset store, so it works even on mobile/tunnel where the browser can't reach the URL directly",
			"",
			"`path` accepts ANY image source: a local file path (absolute or relative to cwd), an http(s) URL, or a `data:` URL. The dashboard reads/downloads the bytes once, persists them, and renders a large inline figure with caption — on web and mobile. Do NOT base64-encode the image yourself; just give the path/URL.",
			"Supported types: PNG, JPEG, GIF, WebP, SVG, AVIF, BMP. Max 5 MB per image.",
		].join("\n"),
		promptSnippet: "Display any image (local path, http(s) URL, or data: URL) inline in the dashboard chat",
		promptGuidelines: [
			"When you want to SHOW an image to the user, use the show_image tool — NOT the read tool, and NOT raw markdown ![](path).",
			"show_image renders a large inline figure (with optional caption) that works on web and mobile; read only dumps the file inside a collapsed tool card.",
			"`path` accepts a local file path, an http(s) URL, or a `data:` URL. For remote URLs the dashboard downloads the bytes and serves them from its own asset store (so it works on mobile/tunnel where the browser can't fetch the URL directly). Never base64-encode the image into the arguments — pass a path or URL.",
		],
		parameters: Type.Object({
			path: Type.String({
				description: "Image source: a local file path (absolute or relative to cwd), an http(s) URL, or a `data:` URL.",
			}),
			caption: Type.Optional(
				Type.String({
					description: "Optional caption shown below the image.",
				}),
			),
			alt: Type.Optional(
				Type.String({
					description: "Optional alt text for accessibility. Defaults to the file name.",
				}),
			),
		}),
		async execute(_toolCallId: any, params: any) {
			const rawPath = typeof params?.path === "string" ? params.path : "";
			const caption = typeof params?.caption === "string" ? params.caption : undefined;
			const alt = typeof params?.alt === "string" ? params.alt : undefined;

			if (!rawPath) {
				return {
					content: [{ type: "text", text: "show_image requires a `path` argument." }],
				};
			}

			const sessionId = deps.getSessionId();
			const alreadyEmitted = deps.getEmittedAssetHashes(sessionId);

			// Dispatch by source kind: remote URL / data: URL / local path.
			// All three funnel through the same hash → asset_register → details
			// path so the dashboard always serves the image from its own asset
			// store (works on mobile/tunnel where the browser can't reach the
			// original source).
			let result: ShowImageOutcome;
			if (isHttpUrl(rawPath)) {
				result = await resolveRemoteImageAsset(rawPath, {
					alreadyEmitted,
					fetchImpl: deps.fetchImpl,
				});
			} else if (isDataUrl(rawPath)) {
				result = resolveDataUrlAsset(rawPath, { alreadyEmitted });
			} else {
				result = resolveShowImageAsset(rawPath, {
					readFile: deps.readFile ?? defaultReadFile,
					cwd: deps.getCwd(),
					alreadyEmitted,
				});
			}

			if (!result.ok) {
				return {
					content: [{ type: "text", text: `Could not show image: ${result.message}` }],
					details: { error: result.reason, message: result.message, path: rawPath },
				};
			}

			// Emit bytes only for newly-seen hashes (dedup across the session).
			if (!result.alreadyEmitted) {
				alreadyEmitted.add(result.hash);
				deps.send({
					type: "asset_register",
					sessionId,
					hash: result.hash,
					mimeType: result.mimeType,
					data: result.data,
				});
			}

			return {
				content: [{ type: "text", text: "Image shown to the user." }],
				details: {
					hash: result.hash,
					caption,
					alt,
					path: rawPath,
					mimeType: result.mimeType,
				},
			};
		},
	});
}

/** For tests that want to reset the idempotency guard. */
export function _resetShowImageToolRegisteredForTests(): void {
	toolRegistered = false;
}
