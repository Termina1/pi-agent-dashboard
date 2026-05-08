## 1. Protocol types (shared)

- [x] 1.1 Add optional `spawnToken?: string` to `SessionRegisterMessage` in `packages/shared/src/protocol.ts`
- [x] 1.2 Add optional `requestId?: string` to `SpawnSessionBrowserMessage` in `packages/shared/src/browser-protocol.ts`
- [x] 1.3 Add optional `requestId?: string` to `ResumeSessionBrowserMessage` in the same file
- [x] 1.4 Add optional `requestId?: string` and `pid?: number` to `SpawnResultBrowserMessage`
- [x] 1.5 Add optional `requestId?: string` and `newSessionId?: string` to `ResumeResultBrowserMessage`
- [x] 1.6 Add optional `spawnRequestId?: string` to the session_added shape (search and update the message shape used by `broadcastSessionAdded` consumers)
- [x] 1.7 Type-checked via `tsc --noEmit -p packages/shared/tsconfig.json` (project uses jiti at runtime, no separate build step)

## 2. Server: env-var injection in `buildSpawnEnv`

- [x] 2.1 Extend `buildSpawnEnv(baseEnv, opts?)` in `packages/server/src/process-manager.ts` to accept `{ spawnToken?: string }`
- [x] 2.2 When `spawnToken` is provided, set `result.PI_DASHBOARD_SPAWN_TOKEN = spawnToken` before returning
- [x] 2.3 Update every internal call site in `process-manager.ts` (tmux, wt, wsl-tmux, headless on Unix and Windows) to pass `spawnToken` through
- [x] 2.4 Add `spawnToken?: string` to `SessionOptions` (or equivalent) so callers can supply it
- [x] 2.5 Add a unit test that asserts `buildSpawnEnv(env, { spawnToken: "tok" })` returns an env with `PI_DASHBOARD_SPAWN_TOKEN === "tok"`

## 3. Server: token minting in `spawnPiSession`

- [x] 3.1 Add a small helper `mintSpawnToken(): string` (uses `crypto.randomUUID()`) in a server-internal module (e.g., `packages/server/src/spawn-token.ts`)
- [x] 3.2 In `spawnPiSession`, mint a token if the caller did not supply one, attach to spawn options, and return it on `SpawnResult` as `spawnToken: string`
- [x] 3.3 Pass `spawnToken` to every spawn-strategy function so each path can include it in `buildSpawnEnv`

## 4. Server: registry updates

- [x] 4.1 Extend `HeadlessEntry` in `packages/server/src/headless-pid-registry.ts` with `spawnToken?: string`
- [x] 4.2 Extend `register(pid, cwd, proc, spawnToken?)` to store the token on the entry
- [x] 4.3 Add `linkByToken(token: string, sessionId: string, pid?: number): boolean` — finds entry by token, sets `sessionId`, returns `true` on match
- [x] 4.4 Add `linkByPid(sessionId: string, pid: number): boolean` — finds entry where `pid === pid && !sessionId`, sets it, returns `true` on match
- [x] 4.5 Keep existing `linkSession(sessionId, cwd)` unchanged as the third tier
- [x] 4.6 Update unit tests in `headless-pid-registry.test.ts` to cover all three tiers and their precedence

## 5. Server: pending-fork-registry re-key by token

- [x] 5.1 Change `pending-fork-registry.ts` `Map` key type to `spawnToken` instead of `cwd`
- [x] 5.2 `recordFork(token, parentSessionId)` — replaces `recordFork(cwd, parentSessionId)`
- [x] 5.3 `consumeFork(token)` — replaces `consumeFork(cwd)`
- [x] 5.4 Keep the 30s expiry timer behaviour
- [x] 5.5 Update `pending-fork-registry.test.ts` for the new keying
- [x] 5.6 Update call sites in `session-action-handler.ts` (`handleResumeSession` mode:"fork" branch) and `event-wiring.ts` (`session_register` consumer) to use the token. Also `session-api.ts` (REST resume) updated.

## 6. Server: pending-attach-registry re-key by token

- [~] 6.1 **DEFERRED**: pending-attach refactor requires extending `piGateway.onSessionRegistered` callback signature to carry `spawnToken` through, plus updating all attach call sites (`handleSpawnSession`, `routes/jj-routes.ts`, `event-wiring.ts`). Existing cwd-FIFO + 60s TTL mitigates the swap race in practice. The primary kill-bug is fixed by sections 4+9. Tracking as follow-up: `pending-attach-by-token`.
- [~] 6.2 deferred (see 6.1)
- [~] 6.3 deferred (see 6.1)
- [~] 6.4 deferred (see 6.1)
- [~] 6.5 deferred (see 6.1)
- [~] 6.6 deferred (see 6.1)

## 7. Server: spawn-register-watchdog third index

- [x] 7.1 Add `byToken: Map<string, Entry>` to the watchdog
- [x] 7.2 Extend `arm()` signature to accept `spawnToken?: string` and index into `byToken` when present
- [x] 7.3 Add `clearByToken(token: string): void` (with cross-clear of cwd/pid indices)
- [x] 7.4 Update `recentlyFired` map to also carry token, late-recovery via token works
- [x] 7.5 Update `spawn-register-watchdog.test.ts` to cover token arm + clear + recovery (7 new tests)
- [x] 7.6 Update `pi-gateway.ts` `session_register` handler to call `clearByToken(msg.spawnToken)` first, then `clearByPid(msg.pid)`, then `clearByCwd(msg.cwd)`

## 8. Server: pendingClientCorrelations + result echo

- [x] 8.1 Create `packages/server/src/pending-client-correlations.ts` exposing `Map<spawnToken, requestId>` with `record`, `consume`, and 60s TTL
- [x] 8.2 Wire into the server context (`BrowserHandlerContext`) and `BrowserGateway` factory; constructed in `server.ts`
- [x] 8.3 In `handleSpawnSession`: if `msg.requestId` is provided, `pendingClientCorrelations.record(spawnToken, msg.requestId)` after spawn; emit `spawn_result` with echoed `requestId` and (when known) `pid`
- [x] 8.4 In `handleResumeSession`: same record on success; emit `resume_result` with echoed `requestId` (all early-return paths also echo)
- [x] 8.5 In `event-wiring.ts` session_register handler: after successful link, look up `pendingClientCorrelations.consume(token)` and stash the `requestId` for the upcoming `session_added` broadcast
- [x] 8.6 Update `broadcastSessionAdded` (or equivalent) to optionally include `spawnRequestId`
- [x] 8.7 Broadcast strategy chosen (per design Decision 6); design.md already documents this.

## 9. Server: integrate three-tier link in event-wiring

- [x] 9.1 In `event-wiring.ts` session_register handler, replace `headlessPidRegistry.linkSession(sessionId, msg.cwd)` with the three-tier dispatch (token → pid → cwd-FIFO with telemetry log on fallback)
- [~] 9.2 Add a unit test in `event-wiring.test.ts` exercising each tier in isolation and the priority order — _coverage delivered by integration tests in section 14 (each tier exercised: linkByToken, linkByPid, linkSession fallback, stale-token degrades)_

## 10. Bridge: read env-var and conditional include

- [x] 10.1 In `packages/extension/src/session-sync.ts::sendStateSync`, read `process.env.PI_DASHBOARD_SPAWN_TOKEN` (gated on `isFirstRegister`)
- [x] 10.2 Include `spawnToken: <value>` in the emitted `session_register` IFF `bc.hasRegisteredOnce === false`
- [x] 10.3 `handleSessionChange` does NOT include `spawnToken` (verified)
- [x] 10.4 Tests added in `session-sync.test.ts`: (a) first register includes token from env, (b) reattach omits it, (c) `handleSessionChange` register omits it, (d) missing env-var produces no field

## 11. Client: requestId + pendingSpawns refactor

- [~] 11.1 **PARTIAL**: kept `spawningCwds: Set<string>` for placeholder/disabled-button UI (cwd-keyed), added parallel `pendingSpawnsRef: Map<requestId, { cwd, kind }>` for correlation. Full refactor to per-requestId-keyed placeholders deferred (see 12.x).
- [x] 11.2 Generate `requestId = crypto.randomUUID()` in `handleSpawnSession` and include in dispatched `spawn_session`
- [x] 11.3 Generate `requestId` in `handleResumeSession` and include in dispatched `resume_session` (also `handleResumeSessionKeepPosition`)
- [~] 11.4 Per-cwd timeout retained (still 30s); per-requestId timeout deferred with 12.x
- [~] 11.5 `clearSpawningCwd` retained; `clearPendingSpawn(requestId)` deferred

## 12. Client: PlaceholderSessionCard keyed by requestId

- [~] 12.1 **DEFERRED**: multi-placeholder-per-cwd UI. Current behavior (single placeholder per cwd via `spawningCwds`) is preserved. The primary fix (auto-select-after-fork) lands without this UI change. Tracking as follow-up: `multi-placeholder-per-cwd`.
- [~] 12.2 deferred (see 12.1)
- [~] 12.3 deferred (see 12.1)

## 13. Client: useMessageHandler updates

- [x] 13.1 In `useMessageHandler.ts` `case "session_added"`: read `msg.spawnRequestId`; if it matches `pendingSpawnsRef`, remove the entry and `navigate(\`/session/${msg.session.id}\`)`. Tier-2 fallback to cwd-FIFO retained for legacy servers.
- [x] 13.2 If `spawnRequestId` is absent or unknown, do NOT auto-navigate (existing natural-arrival behavior preserved)
- [x] 13.3 In `case "spawn_result"`: when `success: false` and `requestId` is echoed, remove the matching `pendingSpawnsRef` entry; cwd-based clearSpawningCwd still fires for placeholder dismiss
- [x] 13.4 In `case "resume_result"`: requestId echoed; on failure drop pendingSpawnsRef entry; on success rely on eventual `session_added.spawnRequestId` (broadcast strategy per design Decision 6)

## 14. Tests: race scenarios

- [x] 14.1 Integration test in `spawn-correlation-token-integration.test.ts` covers two same-cwd spawns linked by token to distinct PIDs (worst-case race-order scenario)
- [x] 14.2 Regression test asserts each session resolves to its OWN pid via `linkByToken` (proves kill-fork-kills-parent is fixed)
- [x] 14.3 Legacy fallback covered via `linkByPid` test in `headless-pid-registry.test.ts` and integration test
- [~] 14.4 cwd-FIFO fallback test — _retained from prior tests_
- [x] 14.5 Token-keyed `pendingForkRegistry` regression test in `pending-fork-registry.test.ts` + integration test
- [~] 14.6 `pendingAttachRegistry` test — _deferred with section 6_

## 15. Tests: client-side correlation

- [~] 15.1 **DEFERRED**: client-side correlation tests. Server-side correlation is fully covered (15 new server tests). Client-side `useMessageHandler` tests would require a React-test setup; the wiring is straightforward (single switch case in useMessageHandler.ts:96–110) and tracked as a follow-up.
- [~] 15.2 deferred
- [~] 15.3 deferred
- [~] 15.4 deferred

## 16. Telemetry / observability

- [x] 16.1 Telemetry: `console.error` emitted in `event-wiring.ts` when cwd-FIFO fallback fires AND a token or pid was supplied (i.e. token mismatch / pid-not-tracked, surfacing real deployment gaps)
- [~] 16.2 docs/architecture.md update — _deferred_

## 17. Documentation

- [~] 17.1 No new shared module (correct — `spawn-token.ts` is server-internal)
- [~] 17.2 docs/file-index-server.md — _deferred_
- [~] 17.3 docs/architecture.md — _deferred_
- [x] 17.4 CHANGELOG.md `[Unreleased]` updated with `Added` entry (token primitive + auto-select), `Fixed` entry (kill-fork-kills-parent)

## 18. Repo-level lint & invariants

- [x] 18.1 `no-direct-process-kill` lint test still passes (verified in full test sweep)
- [~] 18.2 lint test for tier ordering — _deferred (semantics are clear from comments + tests)_
- [~] 18.3 lint test for env-var read scope — _deferred_

## 19. Build & verify

- [x] 19.1 Type-check via `tsc --noEmit` clean for our changes (server + shared)
- [x] 19.2 Full `npm test` run: 4663 passed, 3 pre-existing jiti failures unchanged (verified by stashing changes and re-running on clean develop)
- [x] 19.3 Only the 3 pre-existing failures present
- [~] 19.4 Local restart smoke — _operator gate_
- [~] 19.5 `npm run reload` — _operator gate_

## 20. Manual verification

- [~] 20.1 Manual: placeholder + auto-select on spawn — _operator gate_
- [~] 20.2 Manual: fork auto-selects new session — _operator gate_
- [~] 20.3 Manual: kill fork doesn't kill parent — _operator gate (regression covered by integration test 14.2)_
- [~] 20.4 Manual: per-strategy — _operator gate_
- [~] 20.5 Manual: cross-group concurrent spawns — _operator gate_
