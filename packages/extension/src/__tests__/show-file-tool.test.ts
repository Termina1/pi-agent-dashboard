import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	resolveShowFileAsset,
	resolveRemoteFileAsset,
	mimeFromPath,
	MAX_SHOW_FILE_BYTES,
	registerShowFileTool,
	_resetShowFileToolRegisteredForTests,
} from "../show-file-tool.js";
import { hashBytes, type ReadFileOutcome } from "../markdown-image-inliner.js";

const MP3 = Buffer.from([0x49, 0x44, 0x33]); // arbitrary bytes
const MP3_HASH = hashBytes(MP3);

function readFileOk(buf: Buffer): ReadFileOutcome {
	return { ok: true, bytes: buf };
}
function readFileErr(kind: "ENOENT" | "EACCES" | "EISDIR" | "EOTHER"): ReadFileOutcome {
	return { ok: false, kind };
}
function memReadFile(fs: Record<string, Buffer | "ENOENT" | "EISDIR">) {
	return (absPath: string): ReadFileOutcome => {
		const v = fs[absPath];
		if (v === "ENOENT") return readFileErr("ENOENT");
		if (v === "EISDIR") return readFileErr("EISDIR");
		if (!v) return readFileErr("ENOENT");
		return readFileOk(v);
	};
}

describe("mimeFromPath", () => {
	it("maps common audio/video/text extensions", () => {
		expect(mimeFromPath("/a/b.mp3")).toBe("audio/mpeg");
		expect(mimeFromPath("/a/b.wav")).toBe("audio/wav");
		expect(mimeFromPath("/a/b.mp4")).toBe("video/mp4");
		expect(mimeFromPath("/a/b.webm")).toBe("video/webm");
		expect(mimeFromPath("/a/b.pdf")).toBe("application/pdf");
		expect(mimeFromPath("/a/b.json")).toBe("application/json");
		expect(mimeFromPath("/a/b.ts")).toBe("text/typescript");
		expect(mimeFromPath("/a/b.md")).toBe("text/markdown");
		expect(mimeFromPath("/a/b.zip")).toBe("application/zip");
	});

	it("falls back to application/octet-stream for unknown ext", () => {
		expect(mimeFromPath("/a/b.weirdext")).toBe("application/octet-stream");
	});

	it("strips query string + fragment from URL-style inputs", () => {
		expect(mimeFromPath("https://x.com/a.mp3?token=abc#frag")).toBe("audio/mpeg");
	});

	it("still recognises image types", () => {
		expect(mimeFromPath("/a/b.png")).toBe("image/png");
		expect(mimeFromPath("/a/b.svg")).toBe("image/svg+xml");
	});
});

describe("resolveShowFileAsset — pure resolver", () => {
	it("returns hash + base64 + mime + size for a fresh file", () => {
		const r = resolveShowFileAsset("/abs/clip.mp3", {
			readFile: memReadFile({ "/abs/clip.mp3": MP3 }),
			cwd: "/abs",
			alreadyEmitted: new Set(),
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.hash).toBe(MP3_HASH);
		expect(r.mimeType).toBe("audio/mpeg");
		expect(r.data).toBe(MP3.toString("base64"));
		expect(r.size).toBe(MP3.length);
		expect(r.alreadyEmitted).toBe(false);
	});

	it("resolves a relative path against cwd", () => {
		const r = resolveShowFileAsset("./clip.mp3", {
			readFile: memReadFile({ "/work/clip.mp3": MP3 }),
			cwd: "/work",
			alreadyEmitted: new Set(),
		});
		expect(r.ok).toBe(true);
	});

	it("reports not_found on ENOENT", () => {
		const r = resolveShowFileAsset("/missing.mp3", {
			readFile: memReadFile({ "/missing.mp3": "ENOENT" }),
			cwd: "/",
			alreadyEmitted: new Set(),
		});
		expect(r).toEqual({ ok: false, reason: "not_found", message: "file not found: /missing.mp3" });
	});

	it("reports read_failed on EISDIR", () => {
		const r = resolveShowFileAsset("/a/dir.mp3", {
			readFile: memReadFile({ "/a/dir.mp3": "EISDIR" }),
			cwd: "/",
			alreadyEmitted: new Set(),
		});
		expect(r).toEqual({ ok: false, reason: "read_failed", message: "file read failed: /a/dir.mp3" });
	});

	it("rejects oversized fresh files (>100MB)", () => {
		const big = Buffer.alloc(MAX_SHOW_FILE_BYTES + 1, 0);
		const r = resolveShowFileAsset("/big.mp4", {
			readFile: memReadFile({ "/big.mp4": big }),
			cwd: "/",
			alreadyEmitted: new Set(),
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.reason).toBe("too_large");
	});

	it("bypasses size cap for already-emitted hashes (dedup)", () => {
		const big = Buffer.alloc(MAX_SHOW_FILE_BYTES + 1, 0);
		const hash = hashBytes(big);
		const alreadyEmitted = new Set([hash]);
		const r = resolveShowFileAsset("/big.mp4", {
			readFile: memReadFile({ "/big.mp4": big }),
			cwd: "/",
			alreadyEmitted,
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.alreadyEmitted).toBe(true);
	});

	it("accepts ANY mime type (no allowlist) — e.g. application/zip", () => {
		const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
		const r = resolveShowFileAsset("/a.zip", {
			readFile: memReadFile({ "/a.zip": zip }),
			cwd: "/",
			alreadyEmitted: new Set(),
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.mimeType).toBe("application/zip");
	});

	it("accepts an unknown extension as application/octet-stream", () => {
		const r = resolveShowFileAsset("/a.weirdext", {
			readFile: memReadFile({ "/a.weirdext": MP3 }),
			cwd: "/",
			alreadyEmitted: new Set(),
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.mimeType).toBe("application/octet-stream");
	});
});

describe("resolveRemoteFileAsset — http(s) URLs", () => {
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

	it("fetches bytes, uses Content-Type, returns asset", async () => {
		const r = await resolveRemoteFileAsset("https://x.com/a.mp3", {
			alreadyEmitted: new Set(),
			fetchImpl: async () => makeFetchResp(MP3, "audio/mpeg"),
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.hash).toBe(MP3_HASH);
		expect(r.mimeType).toBe("audio/mpeg");
		expect(r.size).toBe(MP3.length);
	});

	it("falls back to URL extension when Content-Type missing", async () => {
		const r = await resolveRemoteFileAsset("https://x.com/a.mp4", {
			alreadyEmitted: new Set(),
			fetchImpl: async () => makeFetchResp(MP3, ""),
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.mimeType).toBe("video/mp4");
	});

	it("rejects non-2xx as not_found", async () => {
		const r = await resolveRemoteFileAsset("https://x.com/missing.mp3", {
			alreadyEmitted: new Set(),
			fetchImpl: async () => makeFetchResp(Buffer.alloc(0), "audio/mpeg", 404),
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.reason).toBe("not_found");
	});
});

describe("registerShowFileTool — tool wiring + dispatch", () => {
	function makePi() {
		const calls: any[] = [];
		return {
			pi: { registerTool: vi.fn((def: any) => calls.push(def)) } as any,
			calls,
		};
	}

	beforeEach(() => {
		_resetShowFileToolRegisteredForTests();
	});

	it("registers a tool named show_file with a flat object schema", () => {
		const { pi, calls } = makePi();
		registerShowFileTool(pi, {
			send: () => {},
			getEmittedAssetHashes: () => new Set(),
			getSessionId: () => "s1",
			getCwd: () => "/work",
		});
		expect(pi.registerTool).toHaveBeenCalledTimes(1);
		const def = calls[0];
		expect(def.name).toBe("show_file");
		expect(def.parameters.type).toBe("object");
		expect(def.parameters.properties.path).toBeDefined();
		expect(def.parameters.required).toEqual(["path"]);
	});

	it("execute reads a local file, emits asset_register, returns details", async () => {
		const sent: any[] = [];
		const { pi, calls } = makePi();
		registerShowFileTool(pi, {
			send: (m) => sent.push(m),
			getEmittedAssetHashes: () => new Set(),
			getSessionId: () => "s1",
			getCwd: () => "/work",
			readFile: memReadFile({ "/work/clip.mp3": MP3 }),
		});
		const out = await calls[0].execute("c1", { path: "clip.mp3", caption: "voice clip", filename: "clip.mp3" });
		expect(sent).toHaveLength(1);
		expect(sent[0]).toEqual({
			type: "asset_register",
			sessionId: "s1",
			hash: MP3_HASH,
			mimeType: "audio/mpeg",
			data: MP3.toString("base64"),
		});
		expect(out.details).toEqual({
			hash: MP3_HASH,
			mimeType: "audio/mpeg",
			size: MP3.length,
			path: "clip.mp3",
			filename: "clip.mp3",
			caption: "voice clip",
		});
	});

	it("does NOT re-emit asset_register for an already-seen hash", async () => {
		const sent: any[] = [];
		const already = new Set([MP3_HASH]);
		const { pi, calls } = makePi();
		registerShowFileTool(pi, {
			send: (m) => sent.push(m),
			getEmittedAssetHashes: () => already,
			getSessionId: () => "s1",
			getCwd: () => "/work",
			readFile: memReadFile({ "/work/clip.mp3": MP3 }),
		});
		await calls[0].execute("c1", { path: "clip.mp3" });
		expect(sent).toHaveLength(0);
	});

	it("execute dispatches an http URL through the remote fetcher", async () => {
		const sent: any[] = [];
		const { pi, calls } = makePi();
		registerShowFileTool(pi, {
			send: (m) => sent.push(m),
			getEmittedAssetHashes: () => new Set(),
			getSessionId: () => "s1",
			getCwd: () => "/work",
			fetchImpl: async () => ({
				ok: true,
				status: 200,
				arrayBuffer: async () => {
					const c = new Uint8Array(MP3.length);
					c.set(MP3);
					return c.buffer;
				},
				headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "audio/mpeg" : null) },
			}),
		});
		const out = await calls[0].execute("c1", { path: "https://x.com/a.mp3" });
		expect(sent).toHaveLength(1);
		expect(out.details.hash).toBe(MP3_HASH);
		expect(out.details.filename).toBe("a.mp3");
	});

	it("execute returns an error result for a missing file", async () => {
		const sent: any[] = [];
		const { pi, calls } = makePi();
		registerShowFileTool(pi, {
			send: (m) => sent.push(m),
			getEmittedAssetHashes: () => new Set(),
			getSessionId: () => "s1",
			getCwd: () => "/work",
			readFile: () => readFileErr("ENOENT"),
		});
		const out = await calls[0].execute("c1", { path: "nope.mp3" });
		expect(sent).toHaveLength(0);
		expect(out.details.error).toBe("not_found");
		expect(out.content[0].text).toContain("Could not show file");
	});

	it("is idempotent — second registration is a no-op", () => {
		const { pi } = makePi();
		const deps = { send: () => {}, getEmittedAssetHashes: () => new Set<string>(), getSessionId: () => "s1", getCwd: () => "/work" };
		registerShowFileTool(pi, deps);
		registerShowFileTool(pi, deps);
		expect(pi.registerTool).toHaveBeenCalledTimes(1);
	});
});
