/**
 * Per-session debounced `.meta.json` writer.
 * Each session gets its own debounce timer — updating session A
 * does not trigger a write for session B.
 */
import { type SessionMeta, writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";

const DEBOUNCE_MS = 1000;

export interface MetaPersistence {
  /** Schedule a debounced write of the session's `.meta.json`. */
  save(sessionFile: string, meta: SessionMeta): void;
  /** Flush all pending writes immediately. */
  flushAll(): void;
  /** Stop all debounce timers. */
  dispose(): void;
}

interface PendingWrite {
  sessionFile: string;
  meta: SessionMeta;
  timer: ReturnType<typeof setTimeout>;
}

export function createMetaPersistence(): MetaPersistence {
  // Keyed by sessionFile path
  const pending = new Map<string, PendingWrite>();

  function writeNow(sessionFile: string): void {
    const entry = pending.get(sessionFile);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(sessionFile);
    try {
      writeSessionMeta(sessionFile, entry.meta);
    } catch (err) {
      console.error(`[meta-persistence] Failed to write session meta for ${sessionFile}:`, err);
    }
  }

  return {
    save(sessionFile: string, meta: SessionMeta): void {
      const existing = pending.get(sessionFile);
      if (existing) {
        // Update meta and reset timer
        clearTimeout(existing.timer);
        existing.meta = meta;
        existing.timer = setTimeout(() => writeNow(sessionFile), DEBOUNCE_MS);
      } else {
        const timer = setTimeout(() => writeNow(sessionFile), DEBOUNCE_MS);
        pending.set(sessionFile, { sessionFile, meta, timer });
      }
    },

    flushAll(): void {
      for (const sessionFile of [...pending.keys()]) {
        writeNow(sessionFile);
      }
    },

    dispose(): void {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
      }
      pending.clear();
    },
  };
}
