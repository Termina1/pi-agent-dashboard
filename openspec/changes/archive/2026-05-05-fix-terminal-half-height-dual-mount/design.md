## Context

**Root cause (verified post-implementation, 2026-05-05)**: the `<TerminalsView>` terminal-area wrapper at `TerminalsView.tsx:137` was `<div className="flex-1 relative min-h-0">` — a `display: block` element with `position: relative`. Its child `<TerminalView>` carries `className="flex-1 flex flex-col min-h-0"` and toggles `display: flex/none`. Because the wrapper is block-level (not `display: flex`), the child's `flex-1` is inert: there is no flex container to claim residual height from, so `<TerminalView>` sizes itself to its content. xterm's default geometry is 24 rows × 15 px line-height = 360 px — which matches exactly what DevTools showed (`<div class="xterm-screen" style="width: 994px; height: 360px;">`). FitAddon's `fit()` runs against a container whose height is already locked to xterm's intrinsic content height, so the resize is a no-op.

The one-line fix is to make the wrapper a flex column:

```diff
- <div className="flex-1 relative min-h-0">
+ <div className="flex-1 flex flex-col min-h-0">
```

The `relative` was vestigial — no `absolute`-positioned descendant anchors against it. Removing it restores the flex chain end-to-end:

```
App main column           flex-1 flex flex-col min-h-0    ✓
  TerminalsView root      flex-1 flex flex-col min-h-0    ✓
    terminal-area         flex-1 flex flex-col min-h-0    ✓  (was: relative ✗)
      TerminalView root   flex-1 flex flex-col min-h-0    ✓
        xterm container   flex-1 min-h-0                  ✓
```

With every link a flex column, the visible `<TerminalView>` (sibling hidden ones are removed from flex layout via `display:none`) claims all residual height. FitAddon's next tick measures the real container height and resizes the PTY to fill it.

**Original (incorrect) hypothesis**: dual-mount of `<TerminalView>` per terminal id producing competing FitAddon resize messages. Verified false: after the dual-mount cleanup landed, `document.querySelectorAll('.xterm').length` became correct (1 per terminal), but the half-height symptom persisted unchanged. The dual-mount cleanup is still valuable as code quality + defense in depth (single owner of mounting, no redundant WebSockets, no resize race) but it was not the root cause.

The bug surfaces only when a user is on `/folder/:encodedCwd/terminals` AND at least one terminal exists in the global `terminals` Map. Two `<TerminalView>` instances mount per terminal id:

1. The "keep-alive" list at `App.tsx:1339-1350`, originally added to keep xterm scrollback alive across navigations to/from the now-defunct `/terminal/:id` route.
2. The `<TerminalsView>` tabbed container, mounted via `folderViewContent` at `App.tsx:1361-1382`, which itself implements its own keep-alive list internally (`TerminalsView.tsx:137-146`).

Both mount paths execute the full `<TerminalView>` effect (`TerminalView.tsx:42-95`):
- Open a fresh `WebSocket /ws/terminal/<id>`
- Server registers them in `entry.clients` (`terminal-manager.ts:163`) — fan-out works for output, but
- Each runs `fitAddon.fit()` and pushes a `{type:"resize", cols, rows}` control message
- The hidden instance (`display:none` on a 0×0 container) computes a fallback near-zero geometry; the visible instance computes the real geometry
- node-pty applies the **last** resize received — order is non-deterministic, but the hidden one wins often enough to produce the visible "half-height" symptom

The `/terminal/:id` route has zero callers in the client tree (`rg "navigate.*terminal/" packages/client/src` is empty). It was removed in change `2026-04-07-folder-editor-terminals` per that proposal's "Modified Capabilities → terminal-emulator" line, but the implementation kept the keep-alive block around with a stale "(for legacy /terminal/:id route)" comment.

Current state of the surrounding pieces:
- Server-side ringbuffer (256 KB, `terminal-manager.ts:10`) replays output on (re)attach — verified path: `browser-gateway.ts:279-284` pushes `terminal_added` for every alive terminal on every WS connect; client mirrors that into its Map (`useMessageHandler.ts:491-514`).
- Idle timer (`idle-timer.ts`) gates auto-shutdown on pi-session count alone; terminals are not factored in.
- `TerminalsView` already implements correct keep-alive within the folder route — switching tabs preserves PTY state via `display:none` toggle.

## Goals / Non-Goals

**Goals:**
- Fix half-height rendering of terminals on the folder-terminals page.
- Make `<TerminalView>` mounting a **single-owner** invariant: at any time, at most one mounted instance per terminal id exists in the React tree.
- Prevent zero-or-near-zero PTY resizes from corrupting `node-pty` geometry — defense in depth even after single-mount lands.
- Stop auto-shutdown from killing terminals when no agent is attached but a PTY is busy.
- Remove the dead `/terminal/:id` route and the stale code keeping it warm.
- Encode the single-mount and resize-floor invariants as spec requirements so the regression doesn't return.

**Non-Goals:**
- Bigger or configurable ringbuffer — separate concern, flagged in earlier exploration.
- Persisting terminals across server restart (e.g. tmux wrapping) — much larger design.
- "Detach without kill" semantic on the X button.
- Visual polish on transient one-frame layout flashes during route transitions.
- Touching `<TerminalView>` itself, the binary frame protocol, or the spawn/kill paths in `terminal-manager.ts` other than the resize-floor guard.

## Decisions

### D0: Repair the CSS flex chain (the actual half-height fix)

**Decision**: Change `TerminalsView.tsx:137` from `<div className="flex-1 relative min-h-0">` to `<div className="flex-1 flex flex-col min-h-0">`.

**Why**: identified post-implementation as the actual root cause; a `display: block` ancestor breaks `flex-1` propagation to `<TerminalView>`, leaving xterm at its 24-row intrinsic content height. See **Context** for the full chain analysis.

**Why over alternatives**:
- _Set explicit `height: 100%` on `<TerminalView>`_: works but couples component layout to ancestor structure; flex chain is the idiomatic Tailwind/Tailwind-like approach already used everywhere else in the codebase.
- _Use `position: absolute; inset: 0` on the visible `<TerminalView>`_: works around the problem rather than fixing it. Adds complexity for no benefit.
- _Add `relative` back "in case some descendant needs it later"_: speculative; YAGNI. Reintroduce only if a concrete absolute-positioned child appears.

### D1: Delete the keep-alive `terminalViews` block, do NOT make it conditional

**Decision**: Outright remove the `terminalViews` `useMemo`, the `useRoute("/terminal/:id")` matcher, the `selectedTerminalId` derivation, the two redirect `useEffect`s, and the `selectedTerminalId ? <div>{terminalViews}</div> : ...` branch. Single owner of `<TerminalView>` mounting becomes `<TerminalsView>`.

**Why over alternatives**:
- _Make it conditional on `selectedTerminalId`_: keeps a dead route alive, doesn't simplify, doesn't fix latent bug for any future remount path.
- _Hoist a single shared keep-alive list to App.tsx and have `<TerminalsView>` reuse it_: would be the right answer if the legacy route had real callers, but it doesn't. Adds an indirection layer for nothing.
- _Use React portals from `<TerminalsView>` to a top-level container_: gives keep-alive across folder-route changes (not just within a folder) — but `TerminalsView` already handles within-folder switching, and across-folder switching is rare enough that the 256 KB server ringbuffer covers it (xterm gets remounted, replays from buffer).

The chosen approach trades a tiny remount cost (when navigating *between* folder-terminals pages, xterm tears down + replays buffer) for clean single-owner semantics. The replay cost is the same path that's already used after every F5; verified working.

### D2: Server-side resize floor in `terminal-manager.ts`

**Decision**: Inside the `attach()` message handler at `terminal-manager.ts:181-198`, when parsing a `{type:"resize"}` control message, ignore it if `cols < 2 || rows < 2`.

**Why**:
- xterm's FitAddon is supposed to guard against zero, but the boundary is murky: a `display:none` container has `clientHeight=0`, FitAddon may compute `rows=1` from `Math.max(1, ...)` on some xterm versions. We've seen anecdotal evidence of `1` slipping through.
- Defense in depth survives any future regression that re-mounts `<TerminalView>` against a hidden container — including third-party plugins.
- A `resize` to 1×1 is never a legitimate user intent. PTY at 1×1 is broken for every shell.
- Cost: one `if` per inbound resize message. Negligible.

**Alternatives considered**:
- _Client-side guard in `<TerminalView>`_: necessary but not sufficient. We don't trust the client to be the only sender of resize messages forever (extension UI plugins exist). Server-side is the durable boundary.
- _Reject and return an error_: noisy, no consumer for it. Silent drop is fine; FitAddon will fire again on the next ResizeObserver tick with valid dimensions.

### D3: Idle timer factors in active PTYs

**Decision**: `idle-timer.ts:onActivity()` (or the equivalent gating function) gets called on every PTY-output chunk, OR the idle check itself short-circuits when `terminalManager.list().length > 0`.

**Pick the latter** — simpler, no per-byte hot path. Idle timer wakes up on its own schedule; when it does, it asks "are there any pi sessions OR any terminals?" before shutting down.

**Why**:
- A user running a 6-hour `cargo build` in a terminal expects the dashboard server to stay up. Today it doesn't.
- Per-byte signaling is wasteful; once-per-idle-tick is plenty.
- Matches mental model: "there are processes I care about → don't shut down".

**Alternatives considered**:
- _Bytes-per-second activity threshold_: complex, hard to tune (`tail -f` is silent, `npm install` is bursty).
- _Terminal-creation-time only_: false negatives when terminals were created hours ago and are still running.
- _User-configurable_: feature creep; default-on is the right call.

### D4: Remove `/terminal/:id` route from url-routing capability

**Decision**: Delete the route entry from the `url-routing` capability spec; remove the `useRoute` matcher in `App.tsx`. Any external bookmark to `/terminal/:id` lands on the SPA fallback (`/`).

**Why**:
- Already removed at the proposal level by `2026-04-07-folder-editor-terminals`. Spec/code were not updated.
- No callers in-tree.
- Folder-scoped `/folder/:encodedCwd/terminals` is the canonical entry point.

**Risk**: someone has a stale bookmark or external integration. Mitigation: the SPA's catch-all route lands them on the home page, not a 404 page. Acceptable given how rarely terminals are deep-linked.

### D5: Spec changes structure

Three small spec deltas, no new capabilities:

| Capability | Change |
|---|---|
| `terminals-view` | ADD requirement: exactly one mounted `<TerminalView>` per terminal id at any time across the whole client tree |
| `terminal-emulator` | ADD requirement: server SHALL reject resize messages with `cols < 2` or `rows < 2` |
| `auto-shutdown` (verify name during specs phase) | ADD requirement: server with one or more attached PTYs SHALL NOT auto-shutdown on idle |
| `url-routing` | REMOVE `/terminal/:id` route entry |

## Risks / Trade-offs

**[R1] Removing keep-alive cross-route loses scrollback when user navigates between folder-terminals pages.**
→ Mitigation: server-side 256 KB ringbuffer replays on reattach. Same path already exercised on F5 and was the agreed-upon mechanism in `terminal-emulator` spec. xterm reconstructs from buffer; cursor position may glitch for one frame on `vim`/`htop` but stabilizes on next keystroke. Documented as known limitation in the spec.

**[R2] `cols < 2 || rows < 2` floor masks future legitimate edge cases.**
→ Very unlikely. PTY at `<2` cols is undefined for every shell binding we support. If a real-world case for tiny terminals emerges, tighten to `cols < 1 || rows < 1` (i.e. only floor literal zero). For now, conservative floor at 2 catches FitAddon's `Math.max(1, ...)` fallback.

**[R3] Idle timer that respects terminals can keep the server up indefinitely if a user starts a `tail -f` and forgets it.**
→ This is the *intended* behavior — terminal is "active work". Existing inactivity-detection mechanisms (manually closing the terminal, killing the server, system shutdown) cover the cleanup paths. If we want a "gentle nag" UX (e.g. dashboard banner: "X terminals running; idle shutdown disabled") that's a separate UX proposal.

**[R4] Removing `/terminal/:id` breaks unknown external integrations.**
→ Low risk. No public API surface, no docs reference the route, no PWA shortcut targets it. If breakage is reported, restore as a redirect-only route that maps to the matching folder-terminals URL — trivial to add.

**[R5] Single-mount removes a defense-in-depth layer for "what if `<TerminalsView>` unmounts unexpectedly".**
→ `<TerminalsView>` only unmounts when navigating away from `/folder/:cwd/terminals`. PTY survives via the server. xterm reconstructs from ringbuffer on return. This is identical to the pre-keep-alive contract; no regression vs. baseline behavior.

## Migration Plan

Single PR, no phasing needed:

1. **Spec updates first** (committed atomically with code or just before):
   - `openspec/specs/terminals-view/spec.md` — add single-mount requirement
   - `openspec/specs/terminal-emulator/spec.md` — add resize-floor requirement, add idle-timer-respects-terminals requirement (or land it under `auto-shutdown` if that's the actual capability name — verify in specs phase)
   - `openspec/specs/url-routing/spec.md` — remove `/terminal/:id` entry

2. **Code changes**:
   - `packages/client/src/App.tsx` — delete keep-alive block, route matcher, derived state, redirect effects, render branch (~50 LOC removed)
   - `packages/server/src/terminal-manager.ts` — add resize floor (~5 LOC)
   - `packages/server/src/idle-timer.ts` and/or `server.ts` — consult `terminalManager.list().length` in idle check (~10 LOC)

3. **Tests**:
   - Unit: server resize-floor (cols=1 → ignored, cols=2 → accepted)
   - Unit: idle-timer with active terminals (does not shut down)
   - Integration / playwright: open folder-terminals page, verify only one `.xterm` element per terminal id, verify height matches container

4. **Rollback**: revert PR. No data migration, no persisted state touched.

5. **Communication**: changelog entry under "Fixed" — half-height terminal, dead-route cleanup, idle-timer-respects-terminals.

## Post-implementation note (2026-05-05)

The original D1 ("delete keep-alive block") was implemented and tested first, expected to fix half-height. Verified via DOM: dual-mount was real and gone, but xterm-screen height still 360 px. DevTools inspection of the ancestor chain revealed the `flex-1 relative min-h-0` block-level node was capping the chain. D0 — the one-line CSS fix — was added afterward and is the actual root-cause repair. Both fixes ship together; D0 is the one users feel, D1 is the structural cleanup that prevents a related class of bugs (resize-message races, redundant WebSockets, dead route).

## Open Questions

**Q1**: Capability name for the idle-shutdown requirement. The proposal said "auto-shutdown (verify)". Need to grep `openspec/specs/` during specs-phase to find the canonical capability — likely `auto-shutdown` or part of `packaging`/`shared-config`. Resolve before writing spec delta.

**Q2**: Should the resize floor be in `terminal-manager.ts` (server-side) only, or also mirrored client-side in `<TerminalView>` for symmetry/local responsiveness? Leaning **server-only** to keep one source of truth, but a client-side guard adds zero cost and prevents the resize message from being sent at all. If specs-phase agrees, add both. Either way, the server guard is the durable boundary.

**Q3**: When migrating, is there value in keeping `/terminal/:id` as a redirect to `/folder/:encodedCwd/terminals` (where cwd is looked up from the terminal id)? Trivially small, friendly to anyone with a stale bookmark. **Lean yes** unless implementation cost surprises us — confirm during tasks-phase.
