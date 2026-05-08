## Why

Browser-rendered terminals on the folder-terminals page (`/folder/:encodedCwd/terminals`) display at roughly **half the available height** of the content column instead of filling it. Symptom is consistent across themes, sizes, and reloads.

Investigation traced the cause to a **dual-mount of `<TerminalView>` per terminal id**:

1. `App.tsx:1338-1350` keeps a global "keep-alive" list — `terminalViews = terminals.map(t => <TerminalView ... visible={selectedTerminalId === t.id} />)` — mounted unconditionally inside the desktop main column at `App.tsx:1582`. The block carries the comment _"Terminal keep-alive views — always mounted, CSS toggled (for legacy `/terminal/:id` route)"_.

2. `App.tsx:1361-1382` builds `folderViewContent`, which on a `/folder/:cwd/terminals` URL renders a `<TerminalsView>` that **also** mounts one `<TerminalView>` per terminal of that folder (its own keep-alive tab pattern from `TerminalsView.tsx:137-146`).

Both blocks render simultaneously inside the same column flex parent. The keep-alive block emits `<TerminalView>` instances with `style={{display: visible ? 'flex' : 'none'}}` and `className="flex-1 flex flex-col min-h-0"` — `display:none` should remove them from flex sizing. **However**, every keep-alive `<TerminalView>` runs its full mount effect (`TerminalView.tsx:42-95`): opens its own `WebSocket /ws/terminal/:id`, registers as a client (server-side `entry.clients.add(ws)` — `terminal-manager.ts:163`), and calls `fitAddon.fit()` → sends a `resize` control message back to the PTY based on its hidden 0×0 container.

Result: **two WebSockets per terminal** (one visible, one hidden), **two AttachAddons writing to the same PTY**, and **two competing resize messages** from FitAddon. The hidden instance — measuring a `display:none` container — computes a near-zero or fallback geometry and pushes a small `resize` to `node-pty`. Whichever resize arrives last wins on the PTY side. The visible xterm renders against its own (correct) geometry but draws the PTY's output, which the PTY laid out at the smaller dimensions. The user sees text packed into the top half of the visible viewport, blank space below — i.e. a "half-height" terminal.

The keep-alive block exists for the `/terminal/:id` route. **That route is dead.** A grep across the client (`packages/client/src/`) shows zero `navigate("/terminal/...")` callers. The route is only matched in `App.tsx:159` to derive `selectedTerminalId`, which is never set because nothing routes there. The `2026-04-07-folder-editor-terminals` change archive explicitly states the route was removed; the comment was left in but the implementation kept the block.

Beyond the half-height bug, the dual mount is also the most likely cause of intermittent input duplication and scrollback drift reported anecdotally — every keystroke fans out to one PTY, but two `AttachAddon`s mirror PTY output into two xterm buffers; if one tab swap toggles `display`, the previously hidden xterm replays whatever stayed in its private buffer and looks "out of sync".

A second smaller bug in the same area: `idle-timer.ts` only counts pi sessions for idleness. A user with a long-running command in a terminal (no agent attached) can still trigger auto-shutdown, which kills every PTY (`server.ts:1265`). That is a separate fix but lives in the same neighborhood and is cheap to bundle.

## What Changes

- **Remove the legacy keep-alive `terminalViews` block.** The `/terminal/:id` route is dead; delete the `useRoute` matcher (`App.tsx:159`), the `selectedTerminalId` derivation (`App.tsx:175`), the `terminalViews` `useMemo` (`App.tsx:1339-1350`), and the two terminal-redirect `useEffect`s (`App.tsx:1385-1397`). Remove the `<TerminalView>` import in `App.tsx` if no longer referenced. Delete the `selectedTerminalId ? <div>{terminalViews}</div>` branch (`App.tsx:1532-1535`) and the `!selectedTerminalId` guards (`App.tsx:1588`, `App.tsx:1417`).
- **Single owner of `<TerminalView>` mounting.** After the removal, `<TerminalsView>` (the tabbed folder view) becomes the only place that ever mounts a `<TerminalView>`. One WebSocket per terminal, one FitAddon per terminal, no resize race.
- **Server-side rejection of zero-dimension resize.** Defense in depth in `terminal-manager.ts` — when an attached client sends `{type:"resize", cols, rows}` with `cols < 2` or `rows < 2`, ignore it. xterm's FitAddon already guards against zero, but a remaining edge case (container torn down mid-resize during a route change) can still leak a `1` through. Survives even if some other code path remounts a hidden `<TerminalView>` in the future.
- **Scope the idle-timer to consider terminals.** `idle-timer.ts:onActivity` is currently called only from pi-session events. Wire `terminalManager.list().length > 0` (or PTY-output activity, whichever is simpler) into the idle reset so a user with an active terminal does not get auto-shut-down. Without this, fixing the half-height issue still leaves a foot-gun where a long-running build dies because no agent was attached.
- **Update `terminals-view` and `terminal-emulator` capability specs.** Codify "exactly one mounted `<TerminalView>` instance per terminal id at any time" as a requirement, and "PTY resize messages with cols<2 or rows<2 SHALL be discarded" as a requirement on the terminal-emulator gateway. Add idle-timer scenario covering active-terminal-prevents-shutdown.
- **Stale comment cleanup.** The `(for legacy /terminal/:id route)` comment goes with the block.
- **No changes to `<TerminalView>` itself, the binary protocol, or `terminal-manager.ts`'s spawn/kill paths.** This is a wiring fix at the App.tsx orchestration layer plus one defensive guard.

## Capabilities

### Modified Capabilities

- `terminals-view`: add requirement — exactly one `<TerminalView>` mounted per terminal id at any time across the whole client tree; remove keep-alive sibling list.
- `terminal-emulator`: add requirement — PTY resize messages with `cols < 2` or `rows < 2` SHALL be ignored by the server.
- `auto-shutdown` (or wherever idle-timer lives — confirm capability name during implementation): add requirement — a server with one or more attached PTYs SHALL NOT auto-shutdown on idle, regardless of pi-session count.
- `url-routing`: REMOVE the `/terminal/:id` route entry. The route has had no callers since `2026-04-07-folder-editor-terminals` archived. Folder-scoped `/folder/:encodedCwd/terminals` is the only terminal route.

## Impact

- **Client**: ~50 LOC removed from `App.tsx` (route matcher, derived state, keep-alive `useMemo`, two redirect effects, branch in main render). Net code reduction. No new components.
- **Server**: ~5 LOC added to `terminal-manager.ts` (one `if (cols < 2 || rows < 2) return;` guard inside the resize-message branch). ~5-10 LOC added to `idle-timer.ts` plus its caller in `server.ts` to factor terminal count into idle gating.
- **Specs**: 2-3 small spec edits, one route removal.
- **Behavior change for users**:
  - Half-height terminal symptom resolved.
  - Long-running terminals no longer killed by idle auto-shutdown when no agent is attached.
  - **Breaking** (theoretical): if any external bookmark or integration still hits `/terminal/:id`, it now 404s into the SPA's catch-all (lands on `/`). No known caller.
- **Performance**: halves the number of `<TerminalView>` React subtrees, xterm instances, and `/ws/terminal/:id` WebSockets when the folder-terminals page is open. Material on long-lived sessions with many terminals.
- **Risk**: low. The keep-alive block was only needed when the legacy route was the *only* viewport; the folder-terminals page subsumed it ~6 weeks ago. Server-side ringbuffer (256 KB) plus the on-connect `terminal_added` push already restore terminal viewports across navigations and reloads — verified in `browser-gateway.ts:279-284`.

## Out of Scope

- Increasing the 256 KB ringbuffer size, or making it configurable. Separate concern; flagged in earlier exploration.
- Persisting terminals across server restarts (e.g. tmux wrapping). Tracked separately; would be a much larger design.
- "Detach without kill" semantic for the X button. Same.
- Visual polish on the half-rendered xterm artifact during the transition (a one-frame flash users sometimes see). Likely fixed by single-mount; if not, follow-up issue.
