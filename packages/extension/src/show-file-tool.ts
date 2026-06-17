/**
 * `show_file` tool registration for the bridge extension.
 *
 * Generalisation of `show_image` for ANY file type: audio, video, PDF, text,
 * archives, documents — anything the model wants to surface inline in the
 * dashboard chat with a clickable open/download link. Reuses the disk-backed
 * asset pipeline (`asset_register` → `~/.pi/dashboard/assets/` →
 * `GET /api/assets/:hash`) so bytes ride bridge→server once (localhost WS),
 * are persisted, and stream to browsers over HTTP with the correct
 * Content-Type — same invariants as `show_image`.
 *
 * Differences from `show_image`:
 *   - No image MIME allowlist — every MIME is accepted (the asset route is
 *     already type-agnostic; `writeAsset` falls back to `.bin` for unknown
 *     extensions, which the extensionless route globs fine).
 *   - Larger per-file cap (100 MB) so audio/video/PDF fit. The bytes still
 *     go base64 over the localhost bridge→server WS once, then stream from
 *     disk over HTTP — big files are heavy over a zrok tunnel but bounded.
 *   - Returns `size` in details so the client renderer can show it.
 *
 * The model passes a local path / http(s) URL / `data:` URL (same dispatch
 * as `show_image`). The dashboard `ShowFileToolRenderer` picks a render
 * strategy by MIME category (audio/video/pdf/image/text/other) and always
 * offers an open/download link to `/api/assets/<hash>`.
 *
 * See change: add-show-file-tool.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { statSync, readFileSync } from "node:fs";
import {
	resolveLocalPath,
	hashBytes,
	type ReadFileOutcome,
} from "./markdown-image-inliner.js";
import {
	isHttpUrl,
	isDataUrl,
	type FetchLike,
} from "./show-image-tool.js";

/** Per-file cap for `show_file` (audio/video/PDF can be large). */
export const MAX_SHOW_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Extension → MIME map (superset of the image inliner's allowlist). Covers the
 * common renderable categories the dashboard renderer branches on; unknown
 * extensions fall back to `application/octet-stream` so the file still
 * round-trips (the route serves it with that Content-Type, the renderer shows
 * a download link). Lowercased extension keys.
 */
const MIME_BY_EXT: Record<string, string> = {
	// images
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".avif": "image/avif",
	".bmp": "image/bmp",
	// audio
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".ogg": "audio/ogg",
	".oga": "audio/ogg",
	".flac": "audio/flac",
	".m4a": "audio/mp4",
	".aac": "audio/aac",
	".opus": "audio/opus",
	".weba": "audio/webm",
	// video
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mov": "video/quicktime",
	".mkv": "video/x-matroska",
	".avi": "video/x-msvideo",
	".ogv": "video/ogg",
	// documents
	".pdf": "application/pdf",
	".html": "text/html",
	".htm": "text/html",
	// text / code (rendered in <pre>, optionally highlighted)
	".txt": "text/plain",
	".md": "text/markdown",
	".markdown": "text/markdown",
	".json": "application/json",
	".jsonl": "application/json",
	".csv": "text/csv",
	".tsv": "text/tab-separated-values",
	".log": "text/plain",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".cjs": "text/javascript",
	".ts": "text/typescript",
	".tsx": "text/typescript",
	".jsx": "text/javascript",
	".py": "text/x-python",
	".rb": "text/x-ruby",
	".go": "text/x-go",
	".rs": "text/x-rust",
	".java": "text/x-java",
	".kt": "text/x-kotlin",
	".swift": "text/x-swift",
	".c": "text/x-c",
	".h": "text/x-c",
	".cpp": "text/x-c++",
	".cc": "text/x-c++",
	".hpp": "text/x-c++",
	".cs": "text/x-csharp",
	".php": "text/x-php",
	".sh": "application/x-sh",
	".bash": "application/x-sh",
	".zsh": "application/x-sh",
	".yml": "text/yaml",
	".yaml": "text/yaml",
	".toml": "text/x-toml",
	".ini": "text/plain",
	".cfg": "text/plain",
	".conf": "text/plain",
	".xml": "application/xml",
	".css": "text/css",
	".scss": "text/x-scss",
	".sql": "application/sql",
	".lua": "text/x-lua",
	".r": "text/x-r",
	".dart": "text/x-dart",
	".vue": "text/x-vue",
	".svelte": "text/x-svelte",
	// archives (download only)
	".zip": "application/zip",
	".tar": "application/x-tar",
	".gz": "application/gzip",
	".tgz": "application/gzip",
	".bz2": "application/x-bzip2",
	".7z": "application/x-7z-compressed",
	".rar": "application/vnd.rar",
	// office (download only — no inline render)
	".doc": "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xls": "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".ppt": "application/vnd.ms-powerpoint",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** Resolve a MIME type from a file path / URL extension. */
export function mimeFromPath(filePathOrUrl: string): string {
	// Strip query string / fragment for URL-style inputs.
	const clean = filePathOrUrl.split("?")[0]!.split("#")[0]!;
	const ext = clean.slice(clean.lastIndexOf(".")).toLowerCase();
	return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** Visible result kinds for the pure resolver. */
export type ShowFileOutcome =
	| { ok: true; hash: string; mimeType: string; data: string; size: number; alreadyEmitted: boolean }
	| { ok: false; reason: "not_found" | "read_failed" | "too_large"; message: string };

export interface ResolveShowFileOptions {
	/** Synchronous file-read callback (same contract as the markdown inliner). */
	readFile: (absolutePath: string) => ReadFileOutcome;
	/** Working directory used to resolve relative `path`s. */
	cwd: string;
	/** Per-session set of hashes already shipped via `asset_register`. */
	alreadyEmitted: Set<string>;
	/** Override the per-file cap. Default `MAX_SHOW_FILE_BYTES`. */
	maxBytes?: number;
}

/**
 * Pure resolver for a local file path. Reads the bytes, derives MIME from the
 * extension, applies the size cap to NEW emissions only (already-registered
 * assets bypass — same invariant as `show_image`), and returns a ready-to-emit
 * asset or a user-facing failure reason. NO MIME allowlist — every type is
 * accepted (the route + renderer are type-agnostic).
 */
export function resolveShowFileAsset(
	rawPath: string,
	opts: ResolveShowFileOptions,
): ShowFileOutcome {
	const absPath = resolveLocalPath(rawPath, opts.cwd);

	const outcome = opts.readFile(absPath);
	if (!outcome.ok) {
		if (outcome.kind === "ENOENT" || outcome.kind === "EACCES") {
			return { ok: false, reason: "not_found", message: `file not found: ${rawPath}` };
		}
		return { ok: false, reason: "read_failed", message: `file read failed: ${rawPath}` };
	}

	const mimeType = mimeFromPath(absPath);
	const hash = hashBytes(outcome.bytes);
	const alreadyEmitted = opts.alreadyEmitted.has(hash);

	if (!alreadyEmitted) {
		const max = opts.maxBytes ?? MAX_SHOW_FILE_BYTES;
		if (outcome.bytes.length > max) {
			const mb = (outcome.bytes.length / (1024 * 1024)).toFixed(1);
			return { ok: false, reason: "too_large", message: `file too large: ${rawPath} (${mb} MB; max 100 MB)` };
		}
	}

	return {
		ok: true,
		hash,
		mimeType,
		data: outcome.bytes.toString("base64"),
		size: outcome.bytes.length,
		alreadyEmitted,
	};
}

export interface ResolveRemoteFileOptions {
	/** Per-session set of hashes already shipped via `asset_register`. */
	alreadyEmitted: Set<string>;
	/** Override fetch (tests inject a stub; production uses global fetch). */
	fetchImpl?: FetchLike;
	/** Override the per-file cap. Default `MAX_SHOW_FILE_BYTES`. */
	maxBytes?: number;
}

/**
 * Async resolver for http(s) URLs: fetches the bytes, derives MIME from
 * Content-Type (falling back to the URL path extension), applies the size
 * cap, returns the asset. Mirrors `resolveRemoteImageAsset`.
 */
export async function resolveRemoteFileAsset(
	url: string,
	opts: ResolveRemoteFileOptions,
): Promise<ShowFileOutcome> {
	const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
	if (!fetchImpl) {
		return { ok: false, reason: "read_failed", message: `fetch unavailable: ${url}` };
	}
	let resp;
	try {
		resp = await fetchImpl(url);
	} catch {
		return { ok: false, reason: "not_found", message: `file fetch failed: ${url}` };
	}
	if (!resp.ok) {
		return { ok: false, reason: "not_found", message: `file fetch failed (${resp.status}): ${url}` };
	}
	let bytes: Buffer;
	try {
		bytes = Buffer.from(await resp.arrayBuffer());
	} catch {
		return { ok: false, reason: "read_failed", message: `file read failed: ${url}` };
	}
	let mime: string | null = null;
	const ct = resp.headers.get("content-type");
	if (ct) mime = ct.split(";")[0]!.trim().toLowerCase() || null;
	if (!mime) mime = mimeFromPath(url);
	else mime = mime as string;

	const hash = hashBytes(bytes);
	const alreadyEmitted = opts.alreadyEmitted.has(hash);
	if (!alreadyEmitted) {
		const max = opts.maxBytes ?? MAX_SHOW_FILE_BYTES;
		if (bytes.length > max) {
			const mb = (bytes.length / (1024 * 1024)).toFixed(1);
			return { ok: false, reason: "too_large", message: `file too large: ${url} (${mb} MB; max 100 MB)` };
		}
	}

	return {
		ok: true,
		hash,
		mimeType: mime,
		data: bytes.toString("base64"),
		size: bytes.length,
		alreadyEmitted,
	};
}

/** Dependencies the bridge injects so the tool can emit assets + track state. */
export interface ShowFileToolDeps {
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

/** Default synchronous fs probe + read (mirrors the bridge's `inlinerReadFile`). */
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

/**
 * Register the `show_file` tool. Idempotent within a process (guarded by
 * `toolRegistered`) so re-registration on session switches is a no-op.
 */
let toolRegistered = false;
export function registerShowFileTool(pi: ExtensionAPI, deps: ShowFileToolDeps): void {
	if (toolRegistered) return;
	toolRegistered = true;

	pi.registerTool({
		name: "show_file",
		label: "Show File",
		description: [
			"Display ANY file inline in the dashboard chat for the user — audio, video, PDF, image, text/code, archives, documents — with a clickable open/download link.",
			"",
			"Use this when you want to surface a file the user should see, hear, or open (NOT for inspecting it yourself — use read for that):",
			"- audio you generated (TTS, music, voice clips)",
			"- video clips / animations",
			"- PDFs / documents",
			"- images (prefer show_image for plain images, but show_file works too)",
			"- any file the user should be able to open or download",
			"",
			"`path` accepts a local file path (absolute or relative to cwd), an http(s) URL, or a `data:` URL. The dashboard reads/downloads the bytes once, persists them, and renders an inline player/preview appropriate to the type, plus an open/download link. Do NOT base64-encode the file yourself; just give the path/URL.",
			"Max 100 MB per file. Remote URLs are fetched server-side so they work on mobile/tunnel where the browser can't reach the URL directly.",
		].join("\n"),
		promptSnippet: "Display any file (audio/video/PDF/image/text/etc) inline in the dashboard chat with an open/download link",
		promptGuidelines: [
			"Use show_file to surface a file the user should see/hear/open (audio, video, PDF, image, text, archives). Use show_image specifically for plain images (it gives a larger figure + lightbox).",
			"`path` accepts a local file path, an http(s) URL, or a `data:` URL. Never base64-encode the file into the arguments.",
			"The dashboard renders an inline player/preview by type and a clickable link to open/download the file. For remote URLs the dashboard fetches the bytes and serves them from its own asset store (works on mobile/tunnel).",
		],
		parameters: Type.Object({
			path: Type.String({
				description: "File source: a local file path (absolute or relative to cwd), an http(s) URL, or a `data:` URL.",
			}),
			caption: Type.Optional(
				Type.String({
					description: "Optional caption shown below the file preview.",
				}),
			),
			filename: Type.Optional(
				Type.String({
					description: "Optional friendly filename for the download link / player title. Defaults to the path basename.",
				}),
			),
		}),
		async execute(_toolCallId: any, params: any) {
			const rawPath = typeof params?.path === "string" ? params.path : "";
			const caption = typeof params?.caption === "string" ? params.caption : undefined;
			const filename = typeof params?.filename === "string" ? params.filename : undefined;

			if (!rawPath) {
				return {
					content: [{ type: "text", text: "show_file requires a `path` argument." }],
				};
			}

			const sessionId = deps.getSessionId();
			const alreadyEmitted = deps.getEmittedAssetHashes(sessionId);

			// Same source dispatch as show_image: remote URL / data: URL / local path.
			let result: ShowFileOutcome;
			if (isHttpUrl(rawPath)) {
				result = await resolveRemoteFileAsset(rawPath, {
					alreadyEmitted,
					fetchImpl: deps.fetchImpl,
				});
			} else if (isDataUrl(rawPath)) {
				result = resolveDataUrlFile(rawPath, { alreadyEmitted });
			} else {
				result = resolveShowFileAsset(rawPath, {
					readFile: deps.readFile ?? defaultReadFile,
					cwd: deps.getCwd(),
					alreadyEmitted,
				});
			}

			if (!result.ok) {
				return {
					content: [{ type: "text", text: `Could not show file: ${result.message}` }],
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

			const friendlyName = filename ?? rawPath.split("/").pop()?.split("?")[0] ?? rawPath;

			return {
				content: [{ type: "text", text: "File shown to the user." }],
				details: {
					hash: result.hash,
					mimeType: result.mimeType,
					size: result.size,
					path: rawPath,
					filename: friendlyName,
					caption,
				},
			};
		},
	});
}

/**
 * Resolver for `data:` URLs (no MIME allowlist — any type accepted). Parses
 * `data:<mime>;base64,<payload>` (or the URL-encoded form), decodes bytes,
 * applies the cap, returns the asset.
 */
function resolveDataUrlFile(
	dataUrl: string,
	opts: { alreadyEmitted: Set<string>; maxBytes?: number },
): ShowFileOutcome {
	const commaIdx = dataUrl.indexOf(",");
	if (commaIdx === -1) {
		return { ok: false, reason: "read_failed", message: `malformed data URL` };
	}
	const meta = dataUrl.slice("data:".length, commaIdx);
	const payload = dataUrl.slice(commaIdx + 1);
	const isBase64 = meta.includes(";base64");
	let mime = meta.split(";")[0] || "application/octet-stream";
	if (!mime) mime = "application/octet-stream";
	let bytes: Buffer;
	try {
		bytes = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload));
	} catch {
		return { ok: false, reason: "read_failed", message: `malformed data URL` };
	}
	const hash = hashBytes(bytes);
	const alreadyEmitted = opts.alreadyEmitted.has(hash);
	if (!alreadyEmitted) {
		const max = opts.maxBytes ?? MAX_SHOW_FILE_BYTES;
		if (bytes.length > max) {
			const mb = (bytes.length / (1024 * 1024)).toFixed(1);
			return { ok: false, reason: "too_large", message: `file too large: data URL (${mb} MB; max 100 MB)` };
		}
	}
	return {
		ok: true,
		hash,
		mimeType: mime,
		data: bytes.toString("base64"),
		size: bytes.length,
		alreadyEmitted,
	};
}

/** For tests that want to reset the idempotency guard. */
export function _resetShowFileToolRegisteredForTests(): void {
	toolRegistered = false;
}
