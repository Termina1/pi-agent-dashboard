import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import {
  CURRENT_SNAPSHOT_PROJECTOR_VERSION,
  CURRENT_SNAPSHOT_SCHEMA_VERSION,
  buildSessionSnapshotFromFile,
  getSessionSnapshotPath,
  isSessionSnapshotFresh,
  projectEntriesToTranscript,
  readSessionSnapshotIfFresh,
  writeSessionSnapshot,
} from "../session-snapshot-store.js";

function tempFile(name = "session.jsonl"): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-snapshot-test-"));
  return join(dir, name);
}

function writeJsonl(file: string, entries: unknown[]): void {
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
}

function baseSnapshot(source: { sessionFile: string; size: number; mtimeMs: number }) {
  return {
    schemaVersion: CURRENT_SNAPSHOT_SCHEMA_VERSION,
    projectorVersion: CURRENT_SNAPSHOT_PROJECTOR_VERSION,
    source,
    builtAt: 100,
    transcript: {
      messages: [],
      tokensIn: 0,
      tokensOut: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      hasFileChanges: false,
      turnStats: [],
      turnCount: 0,
    },
  };
}

describe("session snapshot sidecar store", () => {
  it("maps a session .jsonl file to a .snapshot.json sidecar", () => {
    expect(getSessionSnapshotPath("/home/me/.pi/agent/sessions/repo/2026-id.jsonl"))
      .toBe("/home/me/.pi/agent/sessions/repo/2026-id.snapshot.json");
  });

  it("validates schema, projector version, source size, and source mtime", () => {
    const source = { sessionFile: "/tmp/s.jsonl", size: 10, mtimeMs: 20 };
    expect(isSessionSnapshotFresh(baseSnapshot(source), source)).toBe(true);
    expect(isSessionSnapshotFresh({ ...baseSnapshot(source), schemaVersion: 0 }, source)).toBe(false);
    expect(isSessionSnapshotFresh({ ...baseSnapshot(source), projectorVersion: 0 }, source)).toBe(false);
    expect(isSessionSnapshotFresh(baseSnapshot({ ...source, size: 11 }), source)).toBe(false);
    expect(isSessionSnapshotFresh(baseSnapshot({ ...source, mtimeMs: 21 }), source)).toBe(false);
  });

  it("writes atomically and reads only fresh snapshots", async () => {
    const sessionFile = tempFile();
    writeJsonl(sessionFile, [{ type: "session", id: "s1", cwd: "/tmp", timestamp: "2026-01-01T00:00:00.000Z" }]);
    const stat = statSync(sessionFile);
    const source = { sessionFile, size: stat.size, mtimeMs: stat.mtimeMs };
    const snapshot = baseSnapshot(source);

    await writeSessionSnapshot(snapshot);
    expect(JSON.parse(readFileSync(getSessionSnapshotPath(sessionFile), "utf8")).source.sessionFile).toBe(sessionFile);
    await expect(readSessionSnapshotIfFresh(sessionFile)).resolves.toMatchObject({ source });

    writeFileSync(sessionFile, `${readFileSync(sessionFile, "utf8")}\n`, "utf8");
    await expect(readSessionSnapshotIfFresh(sessionFile)).resolves.toBeNull();
  });
});

describe("session snapshot projector", () => {
  it("projects user and assistant transcript with stats, model, context usage, and entry ids", () => {
    const transcript = projectEntriesToTranscript("s1", [
      { type: "model_change", provider: "anthropic", modelId: "claude-sonnet-4", timestamp: "2026-01-01T00:00:00.000Z" },
      {
        type: "message",
        id: "u1",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "hello" }] },
      },
      {
        type: "message",
        id: "a1",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hi" }],
          usage: {
            input: 10,
            output: 4,
            cacheRead: 2,
            cacheWrite: 1,
            totalTokens: 14,
            cost: { total: 0.02 },
          },
        },
      },
    ], 1_000_000);

    expect(transcript.model).toBe("anthropic/claude-sonnet-4");
    expect(transcript.messages.map((m) => [m.role, m.content, m.entryId])).toEqual([
      ["user", "hello", "u1"],
      ["assistant", "hi", "a1"],
    ]);
    expect(transcript.tokensIn).toBe(10);
    expect(transcript.tokensOut).toBe(4);
    expect(transcript.cacheRead).toBe(2);
    expect(transcript.cacheWrite).toBe(1);
    expect(transcript.cost).toBe(0.02);
    expect(transcript.contextUsage).toEqual({ tokens: 14, contextWindow: 1_000_000 });
    expect(transcript.messages[0].turnIndex).toBe(0);
    expect(transcript.turnStats).toEqual([{ input: 10, output: 4, cacheRead: 2, cacheWrite: 1, turnIndex: 0 }]);
  });

  it("pairs tool calls with results, images, durations, and file-change detection", () => {
    const transcript = projectEntriesToTranscript("s1", [
      {
        type: "message",
        id: "a1",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "I will read it" },
            { type: "toolCall", id: "tc1", name: "Read", arguments: JSON.stringify({ path: "photo.png" }) },
            { type: "toolCall", id: "tc2", name: "Edit", arguments: { path: "file.ts" } },
          ],
        },
      },
      {
        type: "message",
        id: "tr1",
        timestamp: "2026-01-01T00:00:03.000Z",
        message: {
          role: "toolResult",
          toolCallId: "tc1",
          toolName: "Read",
          content: [
            { type: "text", text: "image read" },
            { type: "image", data: "abc", mimeType: "image/png" },
          ],
          isError: false,
        },
      },
      {
        type: "message",
        id: "tr2",
        timestamp: "2026-01-01T00:00:04.000Z",
        message: {
          role: "toolResult",
          toolCallId: "tc2",
          toolName: "Edit",
          content: [{ type: "text", text: "edited" }],
          isError: true,
        },
      },
    ]);

    expect(transcript.messages.map((m) => m.role)).toEqual(["assistant", "toolResult", "toolResult"]);
    expect(transcript.messages[1]).toMatchObject({
      toolCallId: "tc1",
      toolName: "Read",
      args: { path: "photo.png" },
      result: "image read",
      toolStatus: "complete",
      images: [{ data: "abc", mimeType: "image/png" }],
      entryId: "tr1",
      duration: 2000,
    });
    expect(transcript.messages[2]).toMatchObject({
      toolCallId: "tc2",
      toolName: "Edit",
      args: { path: "file.ts" },
      result: "edited",
      toolStatus: "error",
      entryId: "tr2",
      duration: 3000,
    });
    expect(transcript.hasFileChanges).toBe(true);
  });

  it("builds a snapshot from a JSONL file using current source metadata", async () => {
    const sessionFile = tempFile();
    writeJsonl(sessionFile, [
      { type: "session", id: "s1", cwd: "/tmp", timestamp: "2026-01-01T00:00:00.000Z" },
      { type: "message", id: "u1", timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "hello" } },
    ]);

    const snapshot = await buildSessionSnapshotFromFile("s1", sessionFile);
    const stat = statSync(sessionFile);
    expect(snapshot.schemaVersion).toBe(CURRENT_SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.projectorVersion).toBe(CURRENT_SNAPSHOT_PROJECTOR_VERSION);
    expect(snapshot.source).toEqual({ sessionFile, size: stat.size, mtimeMs: stat.mtimeMs });
    expect(snapshot.transcript.messages[0]).toMatchObject({ role: "user", content: "hello", entryId: "u1" });
  });

  it("rejects invalid JSONL headers instead of persisting an empty snapshot", async () => {
    const sessionFile = tempFile();
    writeJsonl(sessionFile, [
      { type: "message", id: "u1", message: { role: "user", content: "hello" } },
    ]);

    await expect(buildSessionSnapshotFromFile("s1", sessionFile)).rejects.toThrow("invalid_session_header");
  });
});
