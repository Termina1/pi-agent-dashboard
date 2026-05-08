## Context

The Electron app spawns the dashboard server, then loads
`http://localhost:8000` in its BrowserWindow. The WS connect from the
window arrives ~1 s after server start, well before the bootstrap's
initial OpenSpec polling completes (5–15 s on a populated repo).

Two existing code paths combine to produce silent data loss:

1. **`session-bootstrap.ts:87`** kicks off
   `void Promise.all(knownDirs.map(refreshOpenSpec))`. PR #10
   (`422bf5d`) changed this from `await` to fire-and-forget for
   Windows-perf reasons. The accompanying comment promises broadcasts
   on completion that the code never wires up. `refreshOpenSpec` is
   contractually a pure cache writer — every other caller
   (`runPostInstallRepair`, `handleOpenSpecRefresh`,
   `toggleTask`'s REST handler) explicitly broadcasts after the await;
   bootstrap does not.

2. **`browser-gateway.ts:238`** filters the on-connect snapshot:
   `if (data && data.initialized) sendTo(...)`. cwds whose cache is
   still empty get nothing sent. After bootstrap silently populates
   the cache, the scheduler's diff check
   (`if (nextJson !== prevJson) onChangeCallback?.(...)`) sees no
   change and stays silent. The cold-boot client never receives an
   `openspec_update` for that cwd until it reconnects.

A regular browser launched minutes later escapes the race because the
cache is hot by then; the same on-connect snapshot succeeds.

A second issue blocks any visible loading feedback: the protocol's
"no message" overload makes the client unable to distinguish "no
openspec here" from "still loading" from "race lost". Any spinner
implementation needs an explicit `pending` signal from the server.

## Goals / Non-Goals

**Goals:**
- Cold-boot Electron client receives `openspec_update` for every known
  cwd without manual reload.
- Client can distinguish "no openspec dir" from "openspec dir present,
  data not yet loaded" so a spinner only renders where appropriate.
- Mirror an existing proven pattern (`runPostInstallRepair` in
  `server.ts:177`) rather than inventing new architecture.
- Zero protocol break: optional `pending` field; old clients ignore it,
  old servers omit it.

**Non-Goals:**
- Speeding up `openspec list` / `openspec status` spawns. The slow
  path remains slow; this change improves *signaling*, not
  *throughput*. Process-pool / bulk-status optimizations are tracked
  separately.
- Fixing the same class of bug in `pi-resources` polling (see
  `directory-service.ts:451-462`). Same pattern, separate proposal.
- Persisting the OpenSpec cache to disk for instant cold-boot data.
  Considered and rejected here — staleness/invalidation cost outweighs
  benefit; the broadcast fix solves the user-visible bug without it.

## Decisions

### D1: Bootstrap broadcasts using `priorEmpty || dataDiffers`

**Decision:** `session-bootstrap.ts` mirrors `runPostInstallRepair`
exactly — capture `prior = getOpenSpecData(cwd)` before refresh,
compute `priorEmpty || JSON.stringify(prior) !== JSON.stringify(fresh)`
after, broadcast iff the predicate holds.

**Alternative considered:** Make `refreshOpenSpec` itself fire
`onChangeCallback` on diff, so all four callers benefit symmetrically.
Rejected because the other three callers
(`runPostInstallRepair`, `handleOpenSpecRefresh`, `toggleTask`)
already broadcast manually; the contract change would force coordinated
edits at all four sites and risk double-broadcasts during transition.
Surgical fix preferred over contract change for a regression that has
a 4-line proven sister implementation in the same repo.

### D2: `pending` field on `OpenSpecData`

**Decision:** Add an optional `pending: boolean` to the
`OpenSpecData` payload. Semantics:
- `pending: true` → server has detected `openspec/changes/` exists for
  this cwd but has not yet received successful slow-poll output
- `pending: false` (or absent) → no `openspec/changes/` detected, OR
  slow-poll has completed (any outcome). Use `initialized` to tell
  these apart.
- The state space the client must reason about:

| `initialized` | `pending` | meaning                                 | UI                       |
|---|---|---|---|
| `false`       | `false`   | no `openspec/changes/` directory        | render nothing           |
| `false`       | `true`    | dir exists, polling not yet complete    | grey spinner             |
| `true`        | (n/a)     | poll complete, data authoritative       | full section / 0-changes |

**Alternative considered:** A `status: "absent" | "pending" | "ready"`
enum. Rejected as more invasive; a single boolean composes cleanly
with the existing `initialized` flag without changing the type's
shape for old consumers.

### D3: Fast detect via `hasOpenSpecDir(cwd)`

**Decision:** Expose `hasOpenSpecDir(cwd: string): boolean` from
`directory-service.ts`. Implementation: `fs.statSync` on
`<cwd>/openspec/changes`, returning `true` iff the path exists and
is a directory. Synchronous, ~10 μs per cwd, no spawn.

The existing `pollOne` already performs the same check internally
(`statMtimeOr(changesRoot)` at `directory-service.ts:240`); this just
exports a tiny wrapper for the on-connect path.

**Alternative considered:** Listing `openspec/changes/*/` on connect
to short-circuit the slow path. Rejected — the dashboard would be
re-implementing OpenSpec's parsing logic (task counts, artifact
statuses, completion). The CLI is the source of truth for
content; we use it only to answer "is there OpenSpec here?".

### D4: On-connect snapshot loop sends one message per known cwd

**Decision:** Replace the `if (data && data.initialized)` filter in
`browser-gateway.ts:230-244` with an unconditional emit per known cwd:

- if `getOpenSpecData(cwd)?.initialized` → send the cached payload
  unchanged
- else if `hasOpenSpecDir(cwd)` → send
  `{ initialized: false, pending: true, changes: [] }`
- else → send `{ initialized: false, pending: false, changes: [] }`

Result: every known cwd has exactly one definitive answer at WS
connect time. No silent omissions. Subsequent broadcasts (D1) upgrade
`pending: true` cwds to `initialized: true` once polling completes.

**Alternative considered:** Send a single bulk message
`{ type: "openspec_snapshot", entries: [...] }` instead of N individual
messages. Rejected — inconsistent with existing per-cwd streaming
architecture and would require dual handler paths on the client.

### D5: Spinner placement and styling

**Decision:** In `FolderOpenSpecSection.tsx`, when the incoming
data has `pending: true`, render a small grey spinner where the
collapsed-row label normally reads `OPENSPEC (N CHANGES)`. Spinner
inherits the same muted text colour as the OpenSpec label (likely
`text-[var(--text-muted)]` or similar — confirm against existing
muted styles). No layout shift: spinner replaces the label only.
The `Refresh`, `Archive`, `Specs` buttons are NOT rendered while
pending (no data to refresh, archive, or browse).

For `pending: false` and `initialized: false`, the section does
not render at all, matching today's behavior for non-OpenSpec dirs.

**Alternative considered:** Skeleton placeholder for the entire
expanded change list. Rejected as over-engineered — the section is
collapsed by default; a single inline spinner replacing the label
gives identical user-visible feedback at a fraction of the code.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Boot-time broadcast burst (N broadcasts as polls complete in parallel). | Bounded by N = known cwd count (typically <20). Each msg ~1–10 KB. Negligible client load. The same burst pattern is already accepted by `runPostInstallRepair` and the WS sub layer. |
| Old clients receive `openspec_update` with `initialized: false` and ignore it (rather than rendering "no openspec"). | Old behavior was already "no openspec render" in this case (the gate filtered them out). Net behavior identical for old clients. |
| Old servers omit `pending`; new client must default to `pending: false`. | Client treats `pending` as `data.pending === true`, never strictly compared. Default-falsy works. |
| `hasOpenSpecDir` runs `statSync` on every connect for every known cwd. With many cwds and frequent reconnects, marginal CPU. | At ~10 μs × 20 cwds = 200 μs per connect — well below the ~1 ms WS handshake itself. Acceptable. |
| If a user creates `openspec/changes/` *after* connect, the new directory is not surfaced until the next poll tick (already true today; not a regression). | Out of scope. The mtime gate / scheduler already covers post-connect changes via existing diff broadcasts. |
| The diff check in D1 (`JSON.stringify(prior) !== JSON.stringify(fresh)`) is O(payload size) per cwd. With large change lists (50+ proposals × multiple artifacts) this could add a few ms per cwd. | Identical pattern is already in `runPostInstallRepair`. Acceptable; the pattern was vetted in production. |

## Migration Plan

1. Add `pending?: boolean` to `OpenSpecData` in `packages/shared/src/types.ts`.
2. Export `hasOpenSpecDir` from `packages/server/src/directory-service.ts`.
3. Update `browser-gateway.ts` connect handler to emit one message per
   known cwd using `hasOpenSpecDir` for the pending flag.
4. Update `session-bootstrap.ts` to broadcast on initial poll completion
   using the `priorEmpty || dataDiffers` pattern from `server.ts:177`.
5. Update `FolderOpenSpecSection.tsx` to render the grey spinner when
   `pending: true`.
6. Add server-side test
   `packages/server/src/__tests__/cold-boot-openspec-broadcast.test.ts`
   simulating a client that connects before initial polling completes
   and asserting `openspec_update` arrives.
7. No data migration. No config changes. No flag-gated rollout — the
   protocol additions are backwards compatible by construction.

**Rollback:** revert the changes; behavior reverts to today's "stays
empty until reload" cold-boot bug. No data corruption risk.

## Open Questions

- Confirm the exact muted text colour token used by the OpenSpec label
  in `FolderOpenSpecSection.tsx` so the spinner matches without a new
  design token. (Read at implementation time; not blocking design.)
- Should the regression test also assert no broadcast fires for cwds
  whose cache was already populated (idempotency on warm restart)? Likely
  yes — mirrors the existing `post-install-openspec-refresh.test.ts`
  contract. Documented in tasks.md.
