import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBranchedSessionFile, loadSessionEntries } from "../session-file-reader.js";

describe("loadSessionEntries", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "session-load-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("preserves append order when no explicit leaf marker exists", () => {
    const sessionFile = join(tmpDir, "test-session.jsonl");
    const entries = [
      { type: "session", id: "sess-1", timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" },
      { type: "message", id: "root", parentId: null, message: { role: "user", content: "root" } },
      { type: "message", id: "branch-a", parentId: "root", message: { role: "assistant", content: "old branch" } },
      { type: "message", id: "branch-b", parentId: "root", message: { role: "user", content: "new branch" } },
      { type: "custom", id: "custom-b", parentId: "branch-b" },
    ];
    writeFileSync(sessionFile, entries.map(e => JSON.stringify(e)).join("\n") + "\n");

    expect(loadSessionEntries(sessionFile).map((e) => e.id)).toEqual(["root", "branch-a", "branch-b", "custom-b"]);
  });

  it("uses explicit leaf marker when present", () => {
    const sessionFile = join(tmpDir, "test-session.jsonl");
    const entries = [
      { type: "session", id: "sess-1", timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" },
      { type: "message", id: "root", parentId: null, message: { role: "user", content: "root" } },
      { type: "message", id: "branch-a", parentId: "root", message: { role: "assistant", content: "old branch" } },
      { type: "message", id: "branch-b", parentId: "root", message: { role: "user", content: "new branch" } },
      { type: "leaf", entryId: "branch-a" },
    ];
    writeFileSync(sessionFile, entries.map(e => JSON.stringify(e)).join("\n") + "\n");

    expect(loadSessionEntries(sessionFile).map((e) => e.id)).toEqual(["root", "branch-a"]);
  });
});

describe("createBranchedSessionFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "session-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSession(entries: any[]): string {
    const path = join(tmpDir, "test-session.jsonl");
    writeFileSync(path, entries.map(e => JSON.stringify(e)).join("\n") + "\n");
    return path;
  }

  it("should create a branched session file with root-to-target path", () => {
    const sessionFile = writeSession([
      { type: "session", id: "sess-1", timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" },
      { type: "message", id: "e1", parentId: null, message: { role: "user", content: "Hello" } },
      { type: "message", id: "e2", parentId: "e1", message: { role: "assistant", content: "Hi" } },
      { type: "message", id: "e3", parentId: "e2", message: { role: "user", content: "More" } },
      { type: "message", id: "e4", parentId: "e3", message: { role: "assistant", content: "Done" } },
    ]);

    const newPath = createBranchedSessionFile(sessionFile, "e2");
    const lines = readFileSync(newPath, "utf-8").trim().split("\n").map(l => JSON.parse(l));

    // Header + 2 entries (e1, e2)
    expect(lines).toHaveLength(3);
    expect(lines[0].type).toBe("session");
    expect(lines[0].parentSession).toBe(sessionFile);
    expect(lines[1].id).toBe("e1");
    expect(lines[1].parentId).toBeNull();
    expect(lines[2].id).toBe("e2");
    expect(lines[2].parentId).toBe("e1");
  });

  it("should throw for non-existent entry ID", () => {
    const sessionFile = writeSession([
      { type: "session", id: "sess-1", timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" },
      { type: "message", id: "e1", parentId: null, message: { role: "user", content: "Hello" } },
    ]);

    expect(() => createBranchedSessionFile(sessionFile, "nonexistent")).toThrow("Entry ID not found");
  });

  it("should throw for non-existent session file", () => {
    expect(() => createBranchedSessionFile("/no/such/file.jsonl", "e1")).toThrow("Session file not found");
  });

  it("should handle single-entry branch (root entry)", () => {
    const sessionFile = writeSession([
      { type: "session", id: "sess-1", timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" },
      { type: "message", id: "e1", parentId: null, message: { role: "user", content: "Hello" } },
    ]);

    const newPath = createBranchedSessionFile(sessionFile, "e1");
    const lines = readFileSync(newPath, "utf-8").trim().split("\n").map(l => JSON.parse(l));

    expect(lines).toHaveLength(2); // header + 1 entry
    expect(lines[1].id).toBe("e1");
    expect(lines[1].parentId).toBeNull();
  });

  it("should generate a new session ID for the branched file", () => {
    const sessionFile = writeSession([
      { type: "session", id: "original-id", timestamp: "2025-01-01T00:00:00Z", cwd: "/tmp" },
      { type: "message", id: "e1", parentId: null, message: { role: "user", content: "Hello" } },
    ]);

    const newPath = createBranchedSessionFile(sessionFile, "e1");
    const header = JSON.parse(readFileSync(newPath, "utf-8").split("\n")[0]);

    expect(header.id).not.toBe("original-id");
    expect(header.id).toMatch(/^[0-9a-f-]+$/); // UUID format
  });
});
