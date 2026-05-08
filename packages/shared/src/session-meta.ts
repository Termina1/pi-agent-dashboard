import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Session metadata stored in a dashboard-owned `.meta.json` file under
 * `~/.pi/dashboard/session-meta/`, keyed by the session's `.jsonl` path.
 *
 * Older versions wrote a sidecar next to the `.jsonl`; reads still fall back to
 * that legacy location for backward compatibility, but new writes always target
 * the dashboard-owned path so observing foreign-user session files never needs
 * write access to the owning user's HOME.
 *
 * Contains dashboard-owned per-session state and cached stats.
 * All fields are optional — a minimal `{ source: "dashboard" }` is valid.
 */
export interface SessionMeta {
  // Dashboard-owned (user-set via UI)
  source?: string;
  name?: string;
  attachedProposal?: string | null;
  hidden?: boolean;

  // Cached identity & state (from .jsonl header / bridge)
  cwd?: string;
  status?: string;
  /**
   * Per-session unread bit; mirrors `DashboardSession.unread`. Persists across
   * server restarts so an unread session stays unread until viewed.
   * See change: session-card-unread-stripes.
   */
  unread?: boolean;
  startedAt?: number;
  endedAt?: number;
  firstMessage?: string;

  // Cached stats (extracted from .jsonl, avoids re-parsing)
  model?: string;
  thinkingLevel?: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  contextTokens?: number;
  contextWindow?: number;

  // Cache freshness — compared against .jsonl mtime
  cachedAt?: number;
}

/**
 * Legacy sidecar path used by older dashboard versions.
 */
export function legacyMetaPath(sessionFile: string): string {
  const dir = path.dirname(sessionFile);
  const base = path.basename(sessionFile, ".jsonl");
  return path.join(dir, `${base}.meta.json`);
}

function getSessionMetaRoot(): string {
  return path.join(os.homedir(), ".pi", "dashboard", "session-meta");
}

function normalizeSessionFileForKey(sessionFile: string): string {
  const normalized = path.isAbsolute(sessionFile)
    ? path.normalize(sessionFile)
    : path.resolve(sessionFile);
  return process.platform === "win32"
    ? normalized.replace(/\\/g, "/").toLowerCase()
    : normalized;
}

function metaFileName(sessionFile: string): string {
  const rawBase = path.basename(sessionFile, ".jsonl") || "session";
  const safeBase = rawBase.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "session";
  const hash = createHash("sha256")
    .update(normalizeSessionFileForKey(sessionFile))
    .digest("hex");
  return path.join(hash.slice(0, 2), `${safeBase}.${hash.slice(0, 16)}.meta.json`);
}

/**
 * Derive the dashboard-owned `.meta.json` path from a `.jsonl` session file
 * path. The file lives under `~/.pi/dashboard/session-meta/` rather than next
 * to the `.jsonl`.
 */
export function metaPath(sessionFile: string): string {
  return path.join(getSessionMetaRoot(), metaFileName(sessionFile));
}

function tryReadMeta(filePath: string): SessionMeta | undefined {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as SessionMeta;
  } catch {
    return undefined;
  }
}

/**
 * Read session metadata from the dashboard-owned file.
 * Falls back to the legacy sidecar path for backward compatibility.
 * Returns undefined if neither file exists or both are invalid.
 */
export function readSessionMeta(sessionFile: string): SessionMeta | undefined {
  return tryReadMeta(metaPath(sessionFile)) ?? tryReadMeta(legacyMetaPath(sessionFile));
}

/**
 * Move a legacy sidecar next to the session `.jsonl` into the dashboard-owned
 * cache path. Returns true when a new dashboard-owned file was created.
 *
 * The legacy file is removed best-effort after the new file is written. If the
 * dashboard-owned file already exists, no move occurs and the legacy file is
 * left untouched to avoid deleting potentially newer data.
 */
export function moveLegacySessionMeta(sessionFile: string): boolean {
  const legacyPath = legacyMetaPath(sessionFile);
  const dashboardPath = metaPath(sessionFile);
  if (!fs.existsSync(legacyPath) || fs.existsSync(dashboardPath)) {
    return false;
  }

  const legacy = tryReadMeta(legacyPath);
  if (!legacy) {
    return false;
  }

  writeSessionMeta(sessionFile, legacy);
  try {
    fs.unlinkSync(legacyPath);
  } catch {
    // Best-effort cleanup only — inability to remove the legacy sidecar must
    // not break the dashboard-owned migration path.
  }
  return true;
}

/**
 * Write session metadata to the dashboard-owned file.
 * Creates parent directories if needed.
 * Uses atomic write (write-to-tmp + rename) to prevent corruption.
 */
export function writeSessionMeta(sessionFile: string, meta: SessionMeta): void {
  const p = metaPath(sessionFile);
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = p + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(meta, null, 2) + "\n");
  fs.renameSync(tmpPath, p);
}

/**
 * Merge new fields into an existing `.meta.json` file.
 * Reads the existing file (including legacy sidecars), merges with the
 * provided partial, and writes atomically to the dashboard-owned path.
 * Fields in `partial` overwrite existing ones.
 * Preserves any unknown fields already in the file.
 */
export function mergeSessionMeta(sessionFile: string, partial: Partial<SessionMeta>): void {
  const existing = readSessionMeta(sessionFile) ?? {};
  const merged = { ...existing, ...partial };
  writeSessionMeta(sessionFile, merged);
}
