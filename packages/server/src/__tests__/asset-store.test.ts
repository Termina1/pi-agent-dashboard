import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
	ASSETS_DIR,
	assetFileName,
	hashBytes,
	writeAsset,
	readAsset,
	readAssetIndex,
	gcAssetStore,
	ensureAssetsDir,
} from "../asset-store.js";

// Redirect ASSETS_DIR to an ephemeral tmp dir per test via module-level
// monkeypatching of the constants the module reads at call time. The module
// resolves paths from CONFIG_DIR at import, so we override the exported
// ASSETS_DIR and the index path indirectly by chdir... simpler: the module
// uses the exported ASSETS_DIR constant for all paths. We can't reassign a
// const export, so instead we test against the REAL ~/.pi/dashboard/assets
// but under the test-isolation HOME (npm test sets HOME to a tmp dir), which
// makes ASSETS_DIR point at an ephemeral location. Clear it between tests.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_HASH = hashBytes(PNG);

function clearAssetsDir() {
	if (existsSync(ASSETS_DIR)) rmSync(ASSETS_DIR, { recursive: true, force: true });
}

beforeEach(() => {
	clearAssetsDir();
});
afterEach(() => {
	clearAssetsDir();
});

describe("assetFileName", () => {
	it("maps known MIME types to extensions", () => {
		expect(assetFileName("abc123", "image/png")).toBe("abc123.png");
		expect(assetFileName("abc123", "image/jpeg")).toBe("abc123.jpg");
		expect(assetFileName("abc123", "image/svg+xml")).toBe("abc123.svg");
	});

	it("falls back to .bin for unknown MIME", () => {
		expect(assetFileName("abc123", "image/heic")).toBe("abc123.bin");
	});
});

describe("writeAsset", () => {
	it("persists bytes to <hash>.<ext> and records mimeType in the index", () => {
		const rec = writeAsset(PNG_HASH, "image/png", PNG.toString("base64"));
		expect(rec).not.toBeNull();
		expect(rec!.filePath).toBe(path.join(ASSETS_DIR, `${PNG_HASH}.png`));
		expect(rec!.mimeType).toBe("image/png");
		expect(existsSync(rec!.filePath)).toBe(true);
		expect(readFileSync(rec!.filePath)).toEqual(PNG);
		expect(readAssetIndex()[PNG_HASH]).toBe("image/png");
	});

	it("is idempotent — re-writing the same hash does not duplicate or error", () => {
		writeAsset(PNG_HASH, "image/png", PNG.toString("base64"));
		const rec2 = writeAsset(PNG_HASH, "image/png", PNG.toString("base64"));
		expect(rec2).not.toBeNull();
		expect(readAssetIndex()[PNG_HASH]).toBe("image/png");
	});

	it("rejects a hash that does not match the bytes (defense-in-depth)", () => {
		const rec = writeAsset("deadbeefdeadbeef", "image/png", PNG.toString("base64"));
		expect(rec).toBeNull();
		// Nothing persisted under the bogus hash.
		expect(readAsset("deadbeefdeadbeef")).toBeNull();
	});

	it("updates the index when mimeType changes for the same hash", () => {
		// Same bytes → same hash, but claim a different MIME. writeAsset trusts
		// the caller's MIME for the filename + index (hash matches bytes).
		writeAsset(PNG_HASH, "image/png", PNG.toString("base64"));
		writeAsset(PNG_HASH, "image/webp", PNG.toString("base64"));
		// Both files may exist; index holds the last-written MIME.
		expect(readAssetIndex()[PNG_HASH]).toBe("image/webp");
	});
});

describe("readAsset", () => {
	it("returns the record for a persisted hash (extensionless lookup)", () => {
		writeAsset(PNG_HASH, "image/png", PNG.toString("base64"));
		const rec = readAsset(PNG_HASH);
		expect(rec).not.toBeNull();
		expect(rec!.mimeType).toBe("image/png");
		expect(rec!.size).toBe(PNG.length);
		expect(rec!.filePath.endsWith(`${PNG_HASH}.png`)).toBe(true);
	});

	it("returns null for an unknown hash", () => {
		expect(readAsset("0123456789abcdef")).toBeNull();
	});

	it("rejects malformed hashes (path-traversal guard)", () => {
		expect(readAsset("../etc/passwd")).toBeNull();
		expect(readAsset("short")).toBeNull();
		expect(readAsset("ZZZZZZZZZZZZZZZZ")).toBeNull(); // non-hex
		expect(readAsset("")).toBeNull();
	});

	it("falls back to application/octet-stream when index lacks the MIME", () => {
		ensureAssetsDir();
		writeFileSync(path.join(ASSETS_DIR, `${PNG_HASH}.png`), PNG);
		// No index entry.
		const rec = readAsset(PNG_HASH);
		expect(rec).not.toBeNull();
		expect(rec!.mimeType).toBe("application/octet-stream");
	});
});

describe("gcAssetStore", () => {
	it("is a no-op when total size is under the cap", () => {
		writeAsset(PNG_HASH, "image/png", PNG.toString("base64"));
		expect(gcAssetStore(1024 * 1024)).toBe(0);
		expect(readAsset(PNG_HASH)).not.toBeNull();
	});

	it("evicts least-recently-written files over the cap", () => {
		// Write two assets with distinct mtimes.
		const a = writeAsset(hashBytes(Buffer.from("aaaa")), "image/png", Buffer.from("aaaa").toString("base64"))!;
		const b = writeAsset(hashBytes(Buffer.from("bbbb")), "image/png", Buffer.from("bbbb").toString("base64"))!;
		// Make `a` older than `b`.
		const oldTime = Date.now() / 1000 - 3600;
		const { utimesSync } = require("node:fs");
		utimesSync(a.filePath, oldTime, oldTime);
		// Cap = 1 byte → both over cap; evict oldest first until under cap.
		// Both are 4 bytes; evicting the oldest (a) leaves 4 bytes still > 1,
		// so b is also evicted. Expect 2 evictions.
		const evicted = gcAssetStore(1);
		expect(evicted).toBe(2);
		expect(readAsset(hashBytes(Buffer.from("aaaa")))).toBeNull();
		expect(readAsset(hashBytes(Buffer.from("bbbb")))).toBeNull();
	});

	it("prunes index entries for evicted files", () => {
		const a = writeAsset(hashBytes(Buffer.from("aaaa")), "image/png", Buffer.from("aaaa").toString("base64"))!;
		const oldTime = Date.now() / 1000 - 3600;
		const { utimesSync } = require("node:fs");
		utimesSync(a.filePath, oldTime, oldTime);
		writeAsset(hashBytes(Buffer.from("bbbb")), "image/png", Buffer.from("bbbb").toString("base64"));
		gcAssetStore(1);
		const index = readAssetIndex();
		expect(index[hashBytes(Buffer.from("aaaa"))]).toBeUndefined();
		expect(index[hashBytes(Buffer.from("bbbb"))]).toBeUndefined();
	});

	it("is safe on a missing assets dir", () => {
		expect(gcAssetStore(1024)).toBe(0);
	});
});
