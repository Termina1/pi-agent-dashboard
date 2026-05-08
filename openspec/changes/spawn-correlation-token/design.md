## Context

The dashboard's session lifecycle today correlates a spawn invocation to its resulting pi process via implicit `(cwd, FIFO order)` tuples spread across five in-memory registries:

| Registry | Key | Failure mode under same-cwd concurrency |
|---|---|---|
| `headlessPidRegistry.linkSession(sid, cwd)` | first unsessioned by cwd | wrong sessionId ↔ pid mapping → kill-fork-kills-parent |
| `pendingForkRegistry` | cwd | second `recordFork` overwrites first → wrong parent attribution |
| `pendingAttachRegistry` | cwd FIFO queue (cap 8) | bridge-connect order ≠ enqueue order → swapped attachments |
| `pendingResumeRegistry` | cwd (last-write-wins) | second prompt clobbers first |
| `spawn-register-watchdog.byCwd` | cwd | second arm overwrites; timeout reports ambiguous cwd |

The bridge already sends `pid: process.pid` and `cwd: process.cwd()` in `session_register` (`packages/extension/src/session-sync.ts:148`). The dashboard already has `process.env`-passthrough at spawn time (`buildSpawnEnv`). The infrastructure is in place — only the **strong identity primitive** is missing.

The four-agent pre-design sweep identified 12 distinct bugs/UX gaps caused by cwd-keying. 11 of them are addressed by a single correlation token primitive; the 12th (visually indistinguishable sessions) is a separate UX concern.

## Goals / Non-Goals

**Goals:**

- Eliminate the kill-fork-kills-parent class of bugs by giving the registry a strong, race-free identity at registration time.
- Enable the client to auto-select a forked session immediately after `session_added`, without cwd-based heuristics.
- Replace cwd-FIFO patterns in pending-fork, pending-attach, and watchdog with strong-key lookups.
- Preserve full backwards compatibility: any combination of {old, new} client × {old, new} server × {old, new} bridge continues to work, with each upgraded component progressively reducing the race surface.
- Reuse existing infrastructure (env-vars, watchdog, registries) rather than introduce new transports or persistence.

**Non-Goals:**

- Do **not** persist tokens. They live only for the spawn-invocation lifetime (≤ watchdog timeout).
- Do **not** change session identity. `sessionId` remains pi-generated; the token correlates the *spawn invocation*, not the session.
- Do **not** address the LLM-pivot proposal-attachment problem (covered by separate `replace-proposal-dialog-with-race-handling`).
- Do **not** unify single-server-only assumption. Multi-server deployments still require shared state (out of scope; documented limitation).
- Do **not** retire the cwd-FIFO `linkSession` path. It stays as the third-tier fallback; removal is a future cleanup once telemetry shows zero token-less registrations.

## Decisions

### Decision 1: Two distinct identifiers — `requestId` (client-minted) and `spawnToken` (server-minted)

**Choice**: Mint two independent UUIDs, one per side.

- `requestId`: client generates one per click. Echoed in `spawn_result` / `resume_result` and broadcast in `session_added.spawnRequestId`. Enables UI correlation when multiple operations are in flight (client knows "this is *my* result").
- `spawnToken`: server generates one per `spawnPiSession` call. Stored in registries; injected into the spawned process's env as `PI_DASHBOARD_SPAWN_TOKEN`; echoed by the bridge in `session_register.spawnToken`. Enables registry correlation.

**Rationale**: The two have different lifetimes and audiences:

- requestId exists from click to first `session_added`. Some spawns have **no client** (auto-resume-on-prompt, jj workspace-add) → no requestId, but still need a token.
- spawnToken exists from `spawnPiSession` call to bridge's first register. The client never sees it; it's purely registry plumbing.

**Alternatives considered**:

- *Single shared id (client-minted, used as token)*: simpler protocol, but breaks for server-initiated spawns and exposes UI-implementation detail to bridge. Rejected.
- *Single server-minted id, returned to client and echoed back*: requires a synchronous round-trip before placeholder UI; client would need to wait for the spawn-result before showing a placeholder. Rejected (UX regression).

### Decision 2: Three-tier link in `headlessPidRegistry`

**Choice**: Add `linkByToken(token, sid, pid)` as primary, with `linkByPid(sid, pid)` second and existing `linkSession(sid, cwd)` cwd-FIFO third.

```
on session_register:
  if msg.spawnToken && registry.entryByToken(msg.spawnToken):
      → linkByToken         ✓ strong identity
  elif msg.pid && registry.entryByPid(msg.pid):
      → linkByPid           ✓ strong identity, no protocol upgrade needed
  elif registry.firstUnsessionedInCwd(msg.cwd):
      → linkSession         (existing cwd-FIFO; for old bridges)
```

**Rationale**: Each fallback is independently correct; the chain shrinks the race window with each upgraded component. The minimum-viable kill-bug fix is achieved at tier 2 (just by reading the pid the bridge already sends), without any protocol upgrade. Tier 1 closes the tmux/wt cases that have no pid.

**Alternatives considered**:

- *Replace `linkSession` outright*: breaks old bridges. Rejected.
- *Remove pid path, only support token*: forces lockstep deployment. Rejected.
- *Add a 60s grace window for late-token recovery (mirroring watchdog `recentlyFired`)*: useful but adds complexity; deferred to a follow-up if telemetry shows benefit.

### Decision 3: Bridge includes token only on the first register

**Choice**: `session-sync.ts` reads `process.env.PI_DASHBOARD_SPAWN_TOKEN` and includes it in `session_register` **iff** `bc.hasRegisteredOnce === false`.

**Rationale**: The token's purpose is to correlate the *original* spawn invocation. After the first register:

- **Reattach** (dashboard restart): the sessionId is already known; reattach disambiguation goes through `registerReason` which is already correct.
- **In-process Ctrl+F fork / /resume / pi-internal /new**: triggers `handleSessionChange`, mints a new sessionId in the same process. The dashboard didn't issue this fork; it has no pending spawn to match. Including the token would alias the new session to the original spawn — wrong semantics.

The pi-internal `/new` (event.reason="new") still gets correlated correctly because it goes through `spawn_new_session` → `spawnPiSession()` → fresh env-var → fresh token in the new process.

**Alternatives considered**:

- *Include token on every register*: aliasing problem above. Rejected.
- *Include token on first register and on registerReason="reattach"*: sessionId already-known on reattach makes token redundant. Rejected.

### Decision 4: Re-key `pendingForkRegistry` and `pendingAttachRegistry` by token

**Choice**: Both registries become `Map<spawnToken, ...>` instead of `Map<cwd, ...>`.

`pendingForkRegistry`:
```
recordFork(token, parentSessionId)        // was: (cwd, parentSessionId)
consumeFork(token)                        // was: (cwd)
```

`pendingAttachRegistry`:
```
enqueue(token, changeName)                // was: (cwd, changeName)
consume(token)                            // was: (cwd)
```

The cwd-FIFO queue in `pendingAttachRegistry` is removed entirely — token-keying makes it unnecessary.

**Rationale**: The original cwd-keying was a workaround for missing identity. With strong identity, a 1:1 `Map<token, …>` is correct and simpler.

**Fallback for old bridges**: keep the cwd-key entries as a separate map; tried second when token-lookup fails. Documented as deprecated.

**Alternatives considered**:

- *Hybrid registry holding both keys*: adds complexity. Chose dual-map fallback for clarity.

### Decision 5: `placeholder-spawn-card` keyed by `requestId`

**Choice**: Client stores `pendingSpawns: Map<requestId, { cwd, startedAt, attachProposal? }>` instead of `spawningCwds: Set<cwd>`. Multiple placeholders may render in the same cwd. Each placeholder is dismissed when `session_added.spawnRequestId === itsRequestId`.

**Rationale**: Today's `Set<cwd>` collapses concurrent spawns into a single placeholder. With requestId, each click owns its own placeholder — clearer state, no first-arrival confusion. Required for auto-select-after-fork to work.

**Alternatives considered**:

- *Keep cwd-Set, ignore concurrent same-cwd spawns*: client UI prevents the common case (button disabled), but programmatic spawns still hit it. Rejected.

### Decision 6: `resume_result.newSessionId` deferred-async for fork mode

**Choice**: For `mode: "fork"`, server does **not** include `newSessionId` in the immediate `resume_result`. The fork's new sessionId is unknown at that point. The client correlates by `requestId` echoed in the eventual `session_added`.

**Rationale**: Avoids blocking `resume_result` on bridge connection (which can take 5-30s). Mirrors the existing spawn flow.

**Alternatives considered**:

- *Defer the entire `resume_result` until link*: blocks UI feedback. Rejected.
- *Add a second `resume_linked` event after `session_added`*: redundant with `session_added.spawnRequestId`. Rejected.

### Decision 7: Token TTL aligned to `spawn-register-watchdog`

**Choice**: Tokens are stored in registries; their effective TTL equals the watchdog timeout (default 30s, configurable 5s–120s). When the watchdog fires, the corresponding registry entries are dropped along with watchdog state.

**Rationale**: One knob, one expiry. Reuses existing recovery semantics (`recentlyFired` 60s late-recovery window). Avoids parallel TTL machinery.

### Decision 8: Watchdog gains `byToken` as third index

**Choice**: `arm({ token, pid, cwd, ... })` indexes into all three maps. `clearByToken(token)` is the strongest clear; pi-gateway calls it first, then `clearByPid` and `clearByCwd` for compatibility.

**Rationale**: Watchdog already dual-indexes (cwd + pid) for the same reason — wrapper-pid mismatch on Unix headless. Adding token is the same pattern.

### Decision 9: Token generation uses `crypto.randomUUID()`

**Choice**: Both client (browser) and server (Node) use the native `crypto.randomUUID()` Web API.

**Rationale**: Available in all supported runtimes (Node 19+, all modern browsers). No dependency added.

## Risks / Trade-offs

[Risk] **Env-var leakage**: `PI_DASHBOARD_SPAWN_TOKEN` ends up in the spawned pi's `process.env`, visible to any tool/skill that inspects env. → **Mitigation**: token is single-use, expires within watchdog TTL, has no auth significance (cannot impersonate; cannot kill any session by knowing the token). Document that PI_DASHBOARD_* vars are dashboard-internal.

[Risk] **Token collision with manually-set env**: an unrelated process or wrapper could set `PI_DASHBOARD_SPAWN_TOKEN` and falsely correlate to a pending spawn. → **Mitigation**: token is a UUIDv4 (122 bits of entropy); collision probability is negligible. The server only honors tokens it has minted (lookup-and-confirm before linking).

[Risk] **Stale token in env after server restart**: server restarts; the spawned pi process retains the now-orphaned env-var; later it might register with a token the new server doesn't know. → **Mitigation**: lookup-and-confirm — server falls through to pid-link, then cwd-FIFO. Stale tokens degrade gracefully to current behavior.

[Risk] **Bridge updates lag server updates**: a deployment ships server v2 (token-aware) but bridge v1 (token-blind). → **Mitigation**: that's exactly the pid-link fallback's job. Bridge v1 sends pid, server v2 uses pid-link, kill-bug fixed without bridge upgrade.

[Risk] **Test surface explodes**: 3-tier matching × 4 spawn strategies × multiple registry types = combinatorial test count. → **Mitigation**: unit-test each tier in isolation; integration-test the priority chain on a small representative matrix; lean on existing watchdog tests as a model.

[Risk] **Multiple placeholders in same cwd may visually surprise users**: previously a second click in a spawning cwd was rejected by disabled-button; with requestId-keyed placeholders, programmatic double-spawn shows two placeholders. → **Mitigation**: programmatic double-spawn is rare and arguably correct UX (acknowledges what the user actually requested). Disabled-button protection on the UI side remains for the common case.

[Trade-off] **Async fork result vs synchronous newSessionId**: chose async to avoid blocking `resume_result`. Cost: client must hold the requestId-keyed pending state until `session_added` arrives, including handling the watchdog-timeout case for forks that never link. Mitigation: existing 30s timeout cleanup in `useSessionActions.ts` already handles this for spawns; extend the same pattern to resume.

[Trade-off] **Three-tier matching adds code**: more conditional logic in `event-wiring.ts` and `headlessPidRegistry`. Cost: ~30 LOC; readability impact small because each tier is a one-liner. Mitigation: comprehensive comments and a single `ResolveStrategy` enum in shared types if the chain grows further.

## Migration Plan

This change ships as a single PR. No persistent state migration. Rollout:

1. **Server** ships first with three-tier link active and token minting on every spawn. Old bridges fall through to pid/cwd; old clients pass nothing extra. Existing tests must still pass.
2. **Bridge** ships next with env-var read + conditional include. This unlocks tier-1 matching.
3. **Client** ships last with requestId mint + auto-select-after-fork. This unlocks the UX gap closure.

Deploying out of order or partial is safe: each step independently improves correctness without breaking older components. **Recommended deployment order is server → bridge → client**, but other orderings work.

**Rollback**: revert the PR. Token fields are optional; absence reverts to today's behavior. Old code paths are preserved as the third tier.

## Open Questions

None remaining after the four-agent exploration sweep. All previously open questions (token source, env access, in-process fork semantics, TTL, jj-plugin needs, bridge-side requirement) were resolved with code evidence before this design was written. See the explore notes attached to this change.
