/**
 * Disk-backed image asset store for the dashboard.
 *
 * Replaces the in-memory `Session.assets[hash] = { data }` base64 cache with
 * a content-addressed file store under `~/.pi/dashboard/assets/`. The bridge
 * still ships `asset_register { hash, mimeType, data }` over the localhost
 * WebSocket (it already read the file); the server PERSISTS the bytes to disk
 * and serves them via the `GET /api/assets/:hash` route. Browsers never
 * receive base64 — they render `<img src="/api/assets/<hash>">` and let HTTP
 * stream + cache the bytes.
 *
 * Layout:
 *   ~/.pi/dashboard/assets/<hash>.<ext>   — the image bytes (ext from MIME)
 *   ~/.pi/dashboard/assets/index.json     — { [hash]: mimeType } (durable)
 *
 * The extension is for human debuggability only; the HTTP route is
 * **extensionless** (`/api/assets/<hash>`) so clients can build the URL from
 * the `pi-asset:<hash>` token alone — no MIME lookup needed client-side,
 * which means rendering survives a cold server restart (the token is in the
 * persisted message text; the file + index survive on disk).
 *
 * GC: `gcAssetStore(maxBytes)` evicts least-recently-written files over the
 * size cap (best-effort; called on server start + periodically).
 *
 * See change: add-disk-backed-image-assets.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "@blackbelt-technology/pi-dashboard-shared/config.js";

/** Root directory for persisted image assets. */
export const ASSETS_DIR = path.join(CONFIG_DIR, "assets");
/** Durable hash → mimeType index. */
const INDEX_FILE = path.join(ASSETS_DIR, "index.json");

/** MIME → extension (reverse of the bridge inliner's allowlist). */
const EXT_BY_MIME: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
	"image/avif": "avif",
	"image/bmp": "bmp",
};

/**
 * Resolve the on-disk filename for a hash + MIME. Returns `<hash>.<ext>` when
 * the MIME is known, falling back to `<hash>.bin` so an unknown MIME still
 * round-trips (the route uses the index MIME for Content-Type, not the ext).
 */
export function assetFileName(hash: string, mimeType: string): string {
	const ext = EXT_BY_MIME[mimeType] ?? "bin";
	return `${hash}.${ext}`;
}

/** Pure: decode a base64 string to a Buffer (throws on invalid base64). */
export function decodeBase64(data: string): Buffer {
	return Buffer.from(data, "base64");
}

/** Pure: sha256-16 hash of bytes — mirrors the bridge's `hashBytes`. */
export function hashBytes(buf: Buffer): string {
	return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

export interface AssetRecord {
	/** Absolute path to the persisted file. */
	filePath: string;
	mimeType: string;
	/** File size in bytes. */
	size: number;
}

/** Read the durable index ({ hash → mimeType }) as a plain object. */
export function readAssetIndex(): Record<string, string> {
	try {
		return JSON.parse(readFileSync(INDEX_FILE, "utf-8"));
	} catch {
		return {};
	}
}

/** Atomically (best-effort) write the durable index. */
function writeAssetIndex(index: Record<string, string>): void {
	writeFileSync(INDEX_FILE, JSON.stringify(index));
}

/** Ensure the assets directory exists. Idempotent. */
export function ensureAssetsDir(): void {
	if (!existsSync(ASSETS_DIR)) mkdirSync(ASSETS_DIR, { recursive: true });
}

/**
 * Persist an image asset: decode base64, verify the hash matches (defense
 * against a misbehaving bridge), write the file, update the index. Idempotent
 * — re-writing the same hash is a no-op if the file already exists.
 *
 * Returns the record, or null if the hash doesn't match the bytes (rejected).
 */
export function writeAsset(hash: string, mimeType: string, base64Data: string): AssetRecord | null {
	ensureAssetsDir();
	const bytes = decodeBase64(base64Data);
	// Defense-in-depth: the bridge computes the hash from the same bytes; a
	// mismatch means a buggy/rogue emitter. Reject rather than persist under
	// a wrong key.
	if (hashBytes(bytes) !== hash) return null;

	const fileName = assetFileName(hash, mimeType);
	const filePath = path.join(ASSETS_DIR, fileName);
	if (!existsSync(filePath)) {
		writeFileSync(filePath, bytes);
	}

	const index = readAssetIndex();
	if (index[hash] !== mimeType) {
		index[hash] = mimeType;
		writeAssetIndex(index);
	}

	return { filePath, mimeType, size: bytes.length };
}

/**
 * Look up a persisted asset by hash. Returns the record (with the MIME from
 * the durable index) or null if no file matches. Used by the HTTP route.
 */
export function readAsset(hash: string): AssetRecord | null {
	// Validate hash shape (16 hex chars) to forbid path traversal via the
	// route param — `<hash>` is used to glob the file, so it must not contain
	// path separators.
	if (!/^[0-9a-f]{16}$/.test(hash)) return null;
	if (!existsSync(ASSETS_DIR)) return null;

	const index = readAssetIndex();
	const mimeType = index[hash];

	// Find the file regardless of extension (the route is extensionless).
	let fileName: string | undefined;
	try {
		fileName = readdirSync(ASSETS_DIR).find((f) => f.startsWith(`${hash}.`));
	} catch {
		return null;
	}
	if (!fileName) return null;

	const filePath = path.join(ASSETS_DIR, fileName);
	try {
		const st = statSync(filePath);
		if (!st.isFile()) return null;
		return { filePath, mimeType: mimeType ?? "application/octet-stream", size: st.size };
	} catch {
		return null;
	}
}

/**
 * Best-effort GC: evict least-recently-written asset files until the total
 * size is under `maxBytes`. Also prunes index entries whose file is gone.
 * Returns the number of files evicted. Safe to call on an empty/missing dir.
 */
export function gcAssetStore(maxBytes: number): number {
	if (!existsSync(ASSETS_DIR)) return 0;
	let entries: { name: string; mtime: number; size: number }[];
	try {
		entries = readdirSync(ASSETS_DIR)
			.filter((f) => f !== "index.json" && f.includes("."))
			.map((name) => {
				const st = statSync(path.join(ASSETS_DIR, name));
				return { name, mtime: st.mtimeMs, size: st.size };
			});
	} catch {
		return 0;
	}

	const total = entries.reduce((s, e) => s + e.size, 0);
	if (total <= maxBytes) return 0;

	// Evict oldest first until under cap.
	entries.sort((a, b) => a.mtime - b.mtime);
	let evicted = 0;
	let remaining = total;
	for (const e of entries) {
		if (remaining <= maxBytes) break;
		try {
			rmSync(path.join(ASSETS_DIR, e.name));
			remaining -= e.size;
			evicted++;
		} catch {
			// best-effort
		}
	}

	// Prune index entries for evicted files.
	if (evicted > 0) {
		const index = readAssetIndex();
		const liveHashes = new Set(
			readdirSync(ASSETS_DIR)
				.filter((f) => f !== "index.json" && f.includes("."))
				.map((f) => f.slice(0, f.indexOf("."))),
		);
		let changed = false;
		for (const h of Object.keys(index)) {
			if (!liveHashes.has(h)) {
				delete index[h];
				changed = true;
			}
		}
		if (changed) writeAssetIndex(index);
	}

	return evicted;
}
