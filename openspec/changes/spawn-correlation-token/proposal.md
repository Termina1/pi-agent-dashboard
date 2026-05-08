## Why

The dashboard correlates a "spawn invocation" to the resulting pi process by `(cwd, FIFO)` in the headless PID registry and by `cwd` in every pending registry (fork, attach, resume). Bridge-connect order is non-deterministic, so two spawns in the same cwd race the registry — most visibly: **killing a forked session sometimes kills its parent** because `linkSession(sessionId, cwd)` picks the first unsessioned entry in the cwd, regardless of which spawn it actually belongs to.

The same root cause produces 11 documented races and UX gaps (ghost sessions, attach-proposal swap, multi-fork ordering loss, tmux watchdog ambiguity, no auto-select after fork). One correlation primitive — a token born at the dashboard's spawn click and round-tripped through env-var → bridge → `session_register` — collapses all of them.

## What Changes

- **NEW** `spawn-correlation` capability: per-spawn `spawnToken` (server-minted UUID) + per-click `requestId` (client-minted UUID). Token flows `server → spawned pi env → bridge → session_register`. RequestId flows `client → server → echoed in spawn/resume_result + session_added`.
- **NEW** environment variable `PI_DASHBOARD_SPAWN_TOKEN` injected by `spawnPiSession` into every spawned pi process.
- **NEW** three-tier registry matching in `headlessPidRegistry`: `linkByToken(token, sid, pid)` → falls back to `linkByPid(sid, pid)` → falls back to existing `linkSession(sid, cwd)` cwd-FIFO. Each fallback is independently correct; rollout is gradual.
- **MODIFIED** `pendingForkRegistry`: keyed by `spawnToken` instead of `cwd`. Fixes multi-fork-in-same-cwd ordering loss.
- **MODIFIED** `pendingAttachRegistry`: keyed by `spawnToken` instead of cwd-FIFO queue. Fixes attach-proposal swap race.
- **MODIFIED** `spawn-register-watchdog`: third index `byToken` alongside existing `byPid` / `byCwd`. Existing TTL semantics preserved.
- **MODIFIED** `placeholder-spawn-card`: keyed by `requestId` rather than `cwd`. Allows multiple placeholders per cwd; placeholder dismissed on `session_added.spawnRequestId` match.
- **MODIFIED** `session-resume`: `resume_result` gains optional `requestId` and `newSessionId` (latter populated for `mode: "fork"` once the new bridge registers; deferred async). Closes "no auto-select after fork" UX gap.
- **MODIFIED** `force-kill-handler`: kill resolution prefers token/pid over cwd-FIFO. Fixes the kill-fork-kills-parent bug.
- **MODIFIED** `shared-protocol`: optional `requestId?` on `spawn_session` / `resume_session`; optional `requestId?` echoed in `spawn_result` / `resume_result`; optional `newSessionId?` in `resume_result`; optional `spawnRequestId?` on `session_added`; optional `spawnToken?` on `session_register` (bridge → server).
- **MODIFIED** `headless-spawn`: spec'd env-var injection contract.
- All new fields are **optional**. Old bridges, old clients, and old servers continue to function (cwd-FIFO fallback). No breaking changes.

## Capabilities

### New Capabilities
- `spawn-correlation`: lifecycle of `spawnToken` and `requestId`; env-var injection contract; three-tier registry matching contract; client-side requestId mint and result correlation; bridge-side conditional token inclusion (first register only).

### Modified Capabilities
- `shared-protocol`: optional `requestId`, `newSessionId`, `spawnRequestId`, `spawnToken` fields added across 5 message types.
- `spawn-register-watchdog`: third index by `spawnToken`; `clearByToken(token)`.
- `placeholder-spawn-card`: keyed by `requestId`; multi-placeholder-per-cwd allowed; dismissal on `session_added.spawnRequestId` match.
- `session-resume`: `resume_result` extended with `requestId` echo and async `newSessionId` for fork mode.
- `headless-spawn`: env-var injection requirement.
- `force-kill-handler`: lookup precedence (token > pid > cwd).

## Impact

**Code**:
- `packages/shared/src/protocol.ts` — `SessionRegisterMessage` + new optional `spawnToken`.
- `packages/shared/src/browser-protocol.ts` — 5 message types extended.
- `packages/server/src/process-manager.ts` — env injection in `buildSpawnEnv`.
- `packages/server/src/headless-pid-registry.ts` — three-tier link + token storage.
- `packages/server/src/pending-fork-registry.ts` — re-key by token.
- `packages/server/src/pending-attach-registry.ts` — re-key by token, drop cwd-FIFO queue.
- `packages/server/src/spawn-register-watchdog.ts` — `byToken` index + `clearByToken`.
- `packages/server/src/browser-handlers/session-action-handler.ts` — mint token, pass to registries, echo requestId.
- `packages/server/src/event-wiring.ts` — `linkByToken` first, broadcast `spawnRequestId` on `session_added`.
- `packages/extension/src/session-sync.ts` — read env, conditional token inclusion gated by `hasRegisteredOnce`.
- `packages/client/src/hooks/useSessionActions.ts` — generate `requestId` per call; track in `pendingSpawns: Map<requestId, ...>`.
- `packages/client/src/hooks/useMessageHandler.ts` — match `session_added.spawnRequestId` for auto-select; works for both spawn and fork.
- `packages/client/src/components/PlaceholderSessionCard.tsx` + `SessionList.tsx` — render keyed by `requestId`.

**APIs**: All optional fields. No breaking changes. Old clients/bridges still work via cwd-FIFO fallback.

**Dependencies**: None added. Token = `crypto.randomUUID()` (Node and browser native).

**Tests**: New scenarios for the three-tier link fallback, concurrent-spawn race, fork-after-fork ordering, attach-swap correctness, and the kill-fork-doesn't-kill-parent contract.

**No persistence**: tokens are in-memory only. Server restart mid-spawn falls through to existing reattach paths.
