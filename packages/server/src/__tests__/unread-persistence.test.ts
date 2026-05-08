import { afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  legacyMetaPath,
  writeSessionMeta,
  readSessionMeta,
  type SessionMeta,
} from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";

/**
 * Persistence round-trip for `SessionMeta.unread`.
 * See change: session-card-unread-stripes.
 */
describe("unread persistence", () => {
  const originalHome = process.env.HOME;

  it("round-trips unread=true through .meta.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unread-meta-"));
    process.env.HOME = dir;
    const sessionFile = path.join(dir, "session-1.jsonl");
    fs.writeFileSync(sessionFile, "");

    const meta: SessionMeta = {
      source: "tui",
      cwd: "/tmp",
      status: "idle",
      unread: true,
    };
    writeSessionMeta(sessionFile, meta);

    const restored = readSessionMeta(sessionFile);
    expect(restored?.unread).toBe(true);
  });

  it("round-trips unread=false through .meta.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unread-meta-"));
    process.env.HOME = dir;
    const sessionFile = path.join(dir, "session-2.jsonl");
    fs.writeFileSync(sessionFile, "");

    writeSessionMeta(sessionFile, { source: "tui", unread: false });
    const restored = readSessionMeta(sessionFile);
    expect(restored?.unread).toBe(false);
  });

  it("absent unread field is undefined on read (back-compat)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unread-meta-"));
    process.env.HOME = dir;
    const sessionFile = path.join(dir, "session-3.jsonl");
    fs.writeFileSync(sessionFile, "");
    fs.writeFileSync(
      legacyMetaPath(sessionFile),
      JSON.stringify({ source: "tui", cwd: "/tmp" }),
    );

    const restored = readSessionMeta(sessionFile);
    expect(restored?.unread).toBeUndefined();
  });

  afterAll(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });
});
