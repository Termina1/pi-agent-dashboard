/**
 * Session bootstrap: discovers sessions from known directories and starts OpenSpec polling.
 * Called during server startup (async, non-blocking).
 */
import type { SessionManager } from "./memory-session-manager.js";
import type { BrowserGateway } from "./browser-gateway.js";
import { isOpenSpecDataEmpty, type DirectoryService } from "./directory-service.js";
import { extractSessionStats } from "./session-stats-reader.js";
import type { SessionSnapshotPrewarmQueue, SessionSnapshotPrewarmJob } from "./session-snapshot-store.js";

export interface SessionBootstrapDeps {
  sessionManager: SessionManager;
  browserGateway: BrowserGateway;
  directoryService: DirectoryService;
  prewarmQueue?: Pick<SessionSnapshotPrewarmQueue, "enqueueMany">;
}

/**
 * Discover sessions from all known directories and broadcast them.
 * Runs async and does not block server startup.
 */
export async function discoverAndBroadcastSessions(deps: SessionBootstrapDeps): Promise<void> {
  const { sessionManager, browserGateway, directoryService, prewarmQueue } = deps;
  const prewarmJobs: SessionSnapshotPrewarmJob[] = [];

  try {
    const dirs = directoryService.knownDirectories();
    for (const cwd of dirs) {
      const discovered = directoryService.discoverSessions(cwd);
      for (const hist of discovered) {
        let contextTokens: number | undefined;
        let contextWindow: number | undefined;
        let model: string | undefined;
        if (hist.sessionFile) {
          try {
            const stats = extractSessionStats(hist.sessionFile);
            if (stats) {
              contextTokens = stats.lastTotalTokens;
              contextWindow = stats.contextWindow;
              model = stats.model;
            }
          } catch { /* ignore */ }
          prewarmJobs.push({
            sessionId: hist.id,
            sessionFile: hist.sessionFile,
            activityAt: hist.modifiedAt,
            contextWindow,
          });
        }
        if (!sessionManager.get(hist.id)) {
          sessionManager.restore({
            id: hist.id,
            cwd: hist.cwd,
            name: hist.name,
            source: "tui",
            status: "ended",
            startedAt: hist.startedAt,
            sessionFile: hist.sessionFile,
            sessionDir: hist.sessionDir,
            firstMessage: hist.firstMessage,
            hidden: true,
            dataUnavailable: true,
            model,
            contextTokens,
            contextWindow,
          });
          const session = sessionManager.get(hist.id);
          if (session) browserGateway.broadcastSessionAdded(session);
        }
      }
    }
  } catch (err) {
    console.error("[dashboard] Session discovery failed:", err);
  }

  if (prewarmJobs.length > 0) {
    prewarmQueue?.enqueueMany(
      prewarmJobs.sort((a, b) => (b.activityAt ?? 0) - (a.activityAt ?? 0)),
    );
  }

  // Start OpenSpec polling, broadcast changes to browsers
  directoryService.startPolling((cwd, data) => {
    browserGateway.broadcastToAll({
      type: "openspec_update",
      cwd,
      data,
    } as any);
  });

  // Initial OpenSpec poll for all known directories.
  //
  // Fire-and-forget: `refreshOpenSpec` / `pollOpenSpec` is synchronous internally
  // (spawnSync per change) — on Windows with many active changes and multiple
  // pinned directories this can block the event loop for minutes, making the
  // HTTP server unresponsive during startup. We intentionally do NOT await it
  // here so HTTP + WebSocket startup completes immediately.
  //
  // After each directory's poll completes, broadcast `openspec_update` to all
  // connected browsers if the prior cache was empty/undefined or the polled
  // data differs from prior — mirroring the proven `runPostInstallRepair`
  // pattern in `server.ts`. This is what unblocks cold-boot Electron clients
  // that connected before the cache was hot.
  //
  // A proper fix for the slow `spawnSync` path is to migrate the openspec
  // Recipe to async spawn; tracked separately. See change:
  // consolidate-tool-resolution. This change covers the broadcast wiring only.
  // See change: fix-cold-boot-openspec-protocol.
  void Promise.all(
    directoryService.knownDirectories().map(async (cwd) => {
      try {
        const prior = directoryService.getOpenSpecData(cwd);
        const fresh = await directoryService.refreshOpenSpec(cwd);
        const priorEmpty = isOpenSpecDataEmpty(prior);
        const dataDiffers = JSON.stringify(prior) !== JSON.stringify(fresh);
        if (priorEmpty || dataDiffers) {
          browserGateway.broadcastToAll({ type: "openspec_update", cwd, data: fresh });
        }
      } catch (err) {
        console.error(`[dashboard] initial openspec poll failed for ${cwd}:`, err);
      }
    }),
  );
}
