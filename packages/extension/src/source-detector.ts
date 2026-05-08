import type { SessionSource } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";

/**
 * Detect the source environment of the current pi session
 * by checking environment variables in priority order.
 *
 * @param hasUI - Whether the pi session has a UI (TUI). When true and ZED_TERM
 *   is set, it means pi TUI is running inside Zed's terminal (not Zed's agent).
 * @param sessionFile - Path to the session's .jsonl file, used to check for
 *   dashboard-owned persisted metadata with source information.
 */
export function detectSessionSource(hasUI?: boolean, sessionFile?: string): SessionSource {
  // Check persisted session metadata written by the dashboard server
  if (sessionFile) {
    const meta = readSessionMeta(sessionFile);
    if (meta?.source === "dashboard") return "dashboard";
  }

  if (process.env.ZED_TERM) {
    if (hasUI) return "tui";
    return "zed";
  }
  if (process.env.TMUX) return "tmux";
  return "tui";
}
