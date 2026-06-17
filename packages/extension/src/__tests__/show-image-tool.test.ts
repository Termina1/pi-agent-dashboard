import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	resolveShowImageAsset,
	resolveRemoteImageAsset,
	resolveDataUrlAsset,
	registerShowImageTool,
	_resetShowImageToolRegisteredForTests,
} from "../show-image-tool.js";
import {
	MAX_PER_IMAGE_BYTES,
	type ReadFileOutcome,
} from "../markdown-image-inliner.js";

// ── fixtures ──────────────────────────────────────────────────────────────
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // arbitrary bytes
const PNG_HASH = require("node:crypto")
	.createHash("sha256")
	.update(PNG_BYTES)
	.digest("hex")
	.slice(0, 16);

function readFileOk(buf: Buffer): ReadFileOutcome {
	return { ok: true, bytes: buf };
}
function readFileErr(kind: "ENOENT" | "EACCES" | "EISDIR" | "EOTHER"): ReadFileOutcome {
	return { ok: false, kind };
}

// in-memory fs keyed by absolute path
function memReadFile(fs: Record<string, Buffer | "ENOENT" | "EISDIR">) {
	return (absPath: string): ReadFileOutcome => {
		const v = fs[absPath];
		if (v === "ENOENT") return readFileErr("ENOENT");
		if (v === "EISDIR") return readFileErr("EISDIR");
		if (!v) return readFileErr("ENOENT");
		return readFileOk(v);
	};
}

describe("resolveShowImageAsset — pure resolver", () => {
	it("returns hash + base64 + mime for a fresh png", () => {
		const alreadyEmitted = new Set<string>();
		const r = resolveShowImageAsset("/abs/shot.png", {
			readFile: memReadFile({ "/abs/shot.png": PNG_BYTES }),
			cwd: "/abs",
			alreadyEmitted,
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.hash).toBe(PNG_HASH);
		expect(r.mimeType).toBe("image/png");
		expect(r.data).toBe(PNG_BYTES.toString("base64"));
		expect(r.alreadyEmitted).toBe(false);
	});

	it("resolves a relative path against cwd", () => {
		const r = resolveShowImageAsset("./shot.png", {
			readFile: memReadFile({ "/work/shot.png": PNG_BYTES }),
			cwd: "/work",
			alreadyEmitted: new Set(),
		});
		expect(r.ok).toBe(true);
	});

	it("strips file:// prefix", () => {
		const r = resolveShowImageAsset("file:///work/shot.png", {
			readFile: memReadFile({ "/work/shot.png": PNG_BYTES }),
			cwd: "/other",
			alreadyEmitted: new Set(),
		});
		expect(r.ok).toBe(true);
	});

	it("reports not_found on ENOENT", () => {
		const r = resolveShowImageAsset("/missing.png", {
			readFile: memReadFile({ "/missing.png": "ENOENT" }),
			cwd: "/",
			alreadyEmitted: new Set(),
		});
		expect(r).toEqual({
			ok: false,
			reason: "not_found",
			message: "image not found: /missing.png",
		});
	});

	it("folds EACCES into not_found (no permission-existence leak)", () => {
		const r = resolveShowImageAsset("/secret.png", {
			readFile: () => readFileErr("EACCES"),
			cwd: "/",
			alreadyEmitted: new Set(),
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.reason).toBe("not_found");
	});

	it("reports read_failed on EISDIR", () => {
		const r = resolveShowImageAsset("/a/dir.png", {
			readFile: memReadFile({ "/a/dir.png": "EISDIR" }),
			cwd: "/",
			alreadyEmitted: new Set(),
		});
		expect(r).toEqual({
			ok: false,
			reason: "read_failed",
			message: "image read failed: /a/dir.png",
		});
	});

	it("reports unsupported_type for non-image extension", () => {
		const r = resolveShowImageAsset("/doc.txt", {
			readFile: memReadFile({ "/doc.txt": Buffer.from("hi") }),
			cwd: "/",
			alreadyEmitted: new Set(),
		});
		expect(r).toEqual({
			ok: false,
			reason: "unsupported_type",
			message: "unsupported image type: /doc.txt",
		});
	});

	it("supports all allowlisted extensions", () => {
		for (const ext of [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp"]) {
			const r = resolveShowImageAsset(`/x${ext}`, {
				readFile: memReadFile({ [`/x${ext}`]: PNG_BYTES }),
				cwd: "/",
				alreadyEmitted: new Set(),
			});
			expect(r.ok, ext).toBe(true);
		}
	});

	it("rejects oversized fresh images", () => {
		const big = Buffer.alloc(MAX_PER_IMAGE_BYTES + 1, 0);
		const r = resolveShowImageAsset("/big.png", {
			readFile: memReadFile({ "/big.png": big }),
			cwd: "/",
			alreadyEmitted: new Set(),
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.reason).toBe("too_large");
		expect(r.message).toContain("image too large");
	});

	it("bypasses size cap for already-emitted hashes (dedup)", () => {
		const big = Buffer.alloc(MAX_PER_IMAGE_BYTES + 1, 0);
		const hash = require("node:crypto")
			.createHash("sha256")
			.update(big)
			.digest("hex")
			.slice(0, 16);
		const alreadyEmitted = new Set([hash]);
		const r = resolveShowImageAsset("/big.png", {
			readFile: memReadFile({ "/big.png": big }),
			cwd: "/",
			alreadyEmitted,
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.alreadyEmitted).toBe(true);
	});
});

// Shared by the wiring + dispatch describe blocks.
function makePi() {
	const calls: any[] = [];
	return {
		pi: { registerTool: vi.fn((def: any) => calls.push(def)) } as any,
		calls,
	};
}

describe("registerShowImageTool — tool wiring", () => {

	beforeEach(() => {
		_resetShowImageToolRegisteredForTests();
	});

	it("registers a tool named show_image with a flat object schema", () => {
		const { pi, calls } = makePi();
		registerShowImageTool(pi, {
			send: () => {},
			getEmittedAssetHashes: () => new Set(),
			getSessionId: () => "s1",
			getCwd: () => "/work",
		});
		expect(pi.registerTool).toHaveBeenCalledTimes(1);
		const def = calls[0];
		expect(def.name).toBe("show_image");
		// Flat object root (OpenAI strict-mode compat) — no root oneOf/anyOf.
		expect(def.parameters.type).toBe("object");
		expect(def.parameters.properties.path).toBeDefined();
		expect(def.parameters.properties.caption).toBeDefined();
		expect(def.parameters.properties.alt).toBeDefined();
		expect(def.parameters.required).toEqual(["path"]);
	});

	it("execute reads file, emits asset_register for new hash, returns details", async () => {
		const sent: any[] = [];
		const sets = new Map<string, Set<string>>();
		const { pi, calls } = makePi();
		registerShowImageTool(pi, {
			send: (m) => sent.push(m),
			getEmittedAssetHashes: (sid) => {
				let s = sets.get(sid);
				if (!s) {
					s = new Set();
					sets.set(sid, s);
				}
				return s;
			},
			getSessionId: () => "s1",
			getCwd: () => "/work",
			readFile: memReadFile({ "/work/shot.png": PNG_BYTES }),
		});
		const def = calls[0];
		const out = await def.execute("call-1", { path: "shot.png", caption: "A shot" });
		expect(sent).toHaveLength(1);
		expect(sent[0]).toEqual({
			type: "asset_register",
			sessionId: "s1",
			hash: PNG_HASH,
			mimeType: "image/png",
			data: PNG_BYTES.toString("base64"),
		});
		expect(out.details).toEqual({
			hash: PNG_HASH,
			caption: "A shot",
			alt: undefined,
			path: "shot.png",
			mimeType: "image/png",
		});
		expect(out.content[0].text).toBe("Image shown to the user.");
	});

	it("execute does NOT re-emit asset_register for an already-seen hash", async () => {
		const sent: any[] = [];
		const already = new Set([PNG_HASH]);
		const { pi, calls } = makePi();
		registerShowImageTool(pi, {
			send: (m) => sent.push(m),
			getEmittedAssetHashes: () => already,
			getSessionId: () => "s1",
			getCwd: () => "/work",
			readFile: memReadFile({ "/work/shot.png": PNG_BYTES }),
		});
		const def = calls[0];
		const out = await def.execute("call-1", { path: "shot.png" });
		expect(sent).toHaveLength(0);
		expect(out.details.hash).toBe(PNG_HASH);
	});

	it("execute returns an error result for a missing file (no asset_register)", async () => {
		const sent: any[] = [];
		const { pi, calls } = makePi();
		registerShowImageTool(pi, {
			send: (m) => sent.push(m),
			getEmittedAssetHashes: () => new Set(),
			getSessionId: () => "s1",
			getCwd: () => "/work",
			readFile: () => readFileErr("ENOENT"),
		});
		const def = calls[0];
		const out = await def.execute("call-1", { path: "nope.png" });
		expect(sent).toHaveLength(0);
		expect(out.details).toEqual({
			error: "not_found",
			message: "image not found: nope.png",
			path: "nope.png",
		});
		expect(out.content[0].text).toContain("Could not show image");
	});

	it("execute rejects a missing path argument", async () => {
		const { pi, calls } = makePi();
		registerShowImageTool(pi, {
			send: () => {},
			getEmittedAssetHashes: () => new Set(),
			getSessionId: () => "s1",
			getCwd: () => "/work",
		});
		const def = calls[0];
		const out = await def.execute("call-1", {});
		expect(out.content[0].text).toContain("requires a `path`");
	});

	it("is idempotent — second registration is a no-op", () => {
		const { pi } = makePi();
		registerShowImageTool(pi, {
			send: () => {},
			getEmittedAssetHashes: () => new Set(),
			getSessionId: () => "s1",
			getCwd: () => "/work",
		});
		registerShowImageTool(pi, {
			send: () => {},
			getEmittedAssetHashes: () => new Set(),
			getSessionId: () => "s1",
			getCwd: () => "/work",
		});
		expect(pi.registerTool).toHaveBeenCalledTimes(1);
	});
});

// ── remote URL + data: URL sources ────────────────────────────────────────
function makeFetchResp(buf: Buffer, mime: string, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		arrayBuffer: async () => {
			const copy = new Uint8Array(buf.length);
			copy.set(buf);
			return copy.buffer;
		},
		headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? mime : null) },
	};
}

describe("resolveRemoteImageAsset — http(s) URLs", () => {
	it("fetches bytes, derives MIME from Content-Type, returns asset", async () => {
		const r = await resolveRemoteImageAsset("https://x.com/a.png", {
			alreadyEmitted: new Set(),
			fetchImpl: async () => makeFetchResp(PNG_BYTES, "image/png"),
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.hash).toBe(PNG_HASH);
		expect(r.mimeType).toBe("image/png");
		expect(r.data).toBe(PNG_BYTES.toString("base64"));
	});

	it("falls back to URL extension when Content-Type missing/unlisted", async () => {
		const r = await resolveRemoteImageAsset("https://x.com/a.jpg", {
			alreadyEmitted: new Set(),
			fetchImpl: async () => makeFetchResp(PNG_BYTES, "application/octet-stream"),
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.mimeType).toBe("image/jpeg");
	});

	it("rejects non-2xx as not_found", async () => {
		const r = await resolveRemoteImageAsset("https://x.com/missing.png", {
			alreadyEmitted: new Set(),
			fetchImpl: async () => makeFetchResp(Buffer.alloc(0), "image/png", 404),
		});
		expect(r).toEqual({ ok: false, reason: "not_found", message: "image fetch failed (404): https://x.com/missing.png" });
	});

	it("rejects network errors as not_found", async () => {
		const r = await resolveRemoteImageAsset("https://x.com/a.png", {
			alreadyEmitted: new Set(),
			fetchImpl: async () => { throw new Error("ECONNREFUSED"); },
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.reason).toBe("not_found");
	});

	it("rejects a non-image Content-Type with no image extension", async () => {
		const r = await resolveRemoteImageAsset("https://x.com/page", {
			alreadyEmitted: new Set(),
			fetchImpl: async () => makeFetchResp(Buffer.from("hi"), "text/html"),
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.reason).toBe("unsupported_type");
	});

	it("returns alreadyEmitted=true for a previously-seen hash (no re-fetch cost beyond the fetch)", async () => {
		const already = new Set([PNG_HASH]);
		const r = await resolveRemoteImageAsset("https://x.com/a.png", {
			alreadyEmitted: already,
			fetchImpl: async () => makeFetchResp(PNG_BYTES, "image/png"),
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.alreadyEmitted).toBe(true);
	});
});

describe("resolveDataUrlAsset — data: URLs", () => {
	it("decodes a base64 data URL", () => {
		const url = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
		const r = resolveDataUrlAsset(url, { alreadyEmitted: new Set() });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.hash).toBe(PNG_HASH);
		expect(r.mimeType).toBe("image/png");
	});

	it("rejects a non-image data URL", () => {
		const r = resolveDataUrlAsset("data:text/plain;base64,aGk=", { alreadyEmitted: new Set() });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.reason).toBe("unsupported_type");
	});

	it("rejects a malformed data URL (no comma)", () => {
		const r = resolveDataUrlAsset("data:image/png", { alreadyEmitted: new Set() });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.reason).toBe("read_failed");
	});
});

describe("show_image execute — source dispatch", () => {
	beforeEach(() => {
		_resetShowImageToolRegisteredForTests();
	});

	it("dispatches an http URL through the remote fetcher", async () => {
		const sent: any[] = [];
		const { pi, calls } = makePi();
		registerShowImageTool(pi, {
			send: (m) => sent.push(m),
			getEmittedAssetHashes: () => new Set(),
			getSessionId: () => "s1",
			getCwd: () => "/work",
			fetchImpl: async () => makeFetchResp(PNG_BYTES, "image/png"),
		});
		const out = await calls[0].execute("c1", { path: "https://x.com/a.png" });
		expect(sent).toHaveLength(1);
		expect(sent[0].hash).toBe(PNG_HASH);
		expect(out.details.hash).toBe(PNG_HASH);
		expect(out.details.path).toBe("https://x.com/a.png");
	});

	it("dispatches a data: URL through the data resolver (no fetch)", async () => {
		const sent: any[] = [];
		const { pi, calls } = makePi();
		registerShowImageTool(pi, {
			send: (m) => sent.push(m),
			getEmittedAssetHashes: () => new Set(),
			getSessionId: () => "s1",
			getCwd: () => "/work",
			fetchImpl: async () => { throw new Error("should not fetch"); },
		});
		const out = await calls[0].execute("c1", { path: `data:image/png;base64,${PNG_BYTES.toString("base64")}` });
		expect(sent).toHaveLength(1);
		expect(out.details.hash).toBe(PNG_HASH);
	});

	it("dispatches a local path through the file reader", async () => {
		const sent: any[] = [];
		const { pi, calls } = makePi();
		registerShowImageTool(pi, {
			send: (m) => sent.push(m),
			getEmittedAssetHashes: () => new Set(),
			getSessionId: () => "s1",
			getCwd: () => "/work",
			readFile: memReadFile({ "/work/shot.png": PNG_BYTES }),
			fetchImpl: async () => { throw new Error("should not fetch"); },
		});
		const out = await calls[0].execute("c1", { path: "shot.png" });
		expect(sent).toHaveLength(1);
		expect(out.details.hash).toBe(PNG_HASH);
	});
});
