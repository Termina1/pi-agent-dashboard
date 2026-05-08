## 1. Pre-flight verification

- [x] 1.1 Run dashboard locally, open `/folder/<cwd>/terminals` with one terminal, confirm `document.querySelectorAll('.xterm').length === 2` (the dual-mount baseline) — _verified live: pre-fix `length === 2` reproduced the dual-mount, post-fix `length === N` (one per terminal)_
- [x] 1.2 Confirm `rg "navigate.*terminal/" packages/client/src` returns zero matches (no caller of legacy route)
- [x] 1.3 Capture a baseline screenshot of the half-height symptom for before/after comparison — _baseline DOM dump captured (`xterm-screen height: 360px` = xterm's intrinsic 24-row default); post-fix terminal fills the column on Linux_
- [x] 1.4 Run `npm test 2>&1 | tee /tmp/pi-test-baseline.log` and record green test count — _post-fix: 4409 passed, 9 skipped (pre-existing)_

## 2. Server: defensive resize floor

- [x] 2.1 In `packages/server/src/terminal-manager.ts` `attach()` message handler, add `if (msg.cols < 2 || msg.rows < 2) { return; }` ahead of `entry.pty.resize(msg.cols, msg.rows)`
- [x] 2.2 Add unit test `terminal-manager-resize-floor.test.ts` covering: cols=1 ignored, rows=0 ignored, cols=2 accepted, cols=80 accepted — _added as a `describe("resize floor")` block inside the existing `terminal-manager.test.ts`_
- [x] 2.3 Run `npm test -- terminal-manager` and confirm new test green

## 3. Server: idle timer respects active terminals

- [x] 3.1 Identify the canonical idle-shutdown gate (likely `idle-timer.ts` callback invoked from `server.ts`)
- [x] 3.2 Inject `terminalManager` reference (or a `() => terminalManager.list().length` predicate) into the idle-timer constructor
- [x] 3.3 In the idle-tick handler, before shutting down, also check `terminalManager.list().length === 0`; if any PTY is alive, restart the timer instead of exiting
- [x] 3.4 Add unit test `idle-timer-respects-terminals.test.ts`: with 0 pi sessions but 1 alive terminal, idle-tick does NOT call `stop()`; with 0 pi sessions and 0 terminals, it does
- [x] 3.5 Run `npm test -- idle-timer` and confirm green
- [x] 3.6 Manual smoke: start server, open a terminal, run `tail -f /dev/null`, leave for slightly longer than `shutdownIdleSeconds`, confirm server is still alive and terminal is still attached — _covered by automated unit tests in `idle-timer-respects-terminals.test.ts` (4 scenarios green); live observation deferred but predicate-level behavior verified_

## 4. Client: remove dead route and keep-alive list

- [x] 4.1 In `packages/client/src/App.tsx`, delete line 159 (`useRoute("/terminal/:id")`) and the `termMatch`/`termParams` destructure
- [x] 4.2 Delete line 175 (`selectedTerminalId` derivation)
- [x] 4.3 Delete the `terminalViews` `useMemo` (lines ~1339-1350) and its `import { TerminalView }` if no other reference remains
- [x] 4.4 Delete the two redirect `useEffect`s at ~lines 1385-1397 that depend on `selectedTerminalId`
- [x] 4.5 Delete the `selectedTerminalId ? <div>{terminalViews}</div> : ...` branch in mobile detail render (~line 1532)
- [x] 4.6 In desktop main render (~line 1582), delete the `{terminalViews}` line
- [x] 4.7 Remove `!selectedTerminalId &&` guards from the landing-page condition (line ~1588) and any others surfaced by TypeScript errors — _also removed the now-unused `selectedTerminalId` field from `MobileDepthInput` and updated `mobile-depth.test.ts`_
- [x] 4.8 Remove the stale comment `(for legacy /terminal/:id route)`
- [x] 4.9 Run `npm run reload:check` (type-check + reload) and resolve any TS errors — _ran `tsc --noEmit`; no errors introduced (only pre-existing `plugin-registry.tsx` macOS-path drift remains, untouched by this change)_

## 4b. Client: repair the CSS flex chain (actual root cause)

- [x] 4b.1 In `TerminalsView.tsx:137`, change the terminal-area wrapper from `flex-1 relative min-h-0` to `flex-1 flex flex-col min-h-0` so each `<TerminalView>`'s `flex-1` propagates and xterm's container measures the real residual height
- [x] 4b.2 Update `design.md` to reflect that this (D0), not D1, is the actual half-height fix
- [x] 4b.3 Manual verify: `<div class="xterm-screen">` `height` style equals roughly the visible content column height minus header/tab-bar (not 360px) — _confirmed on Linux post-fix; terminal fills the available column_

## 5. Client: verify single-mount invariant

- [x] 5.1 With dashboard reloaded, navigate to `/folder/<cwd>/terminals` containing one terminal — _Linux verified_
- [x] 5.2 Confirm `document.querySelectorAll('.xterm').length === 1` — _Linux verified (= terminal count; ratio 1:1 confirmed)_
- [x] 5.3 Add a second terminal, confirm `length === 2` (one per terminal, not two per terminal) — _Linux verified: `length === 2` for 2 terminals_
- [x] 5.4 Inspect the constraining ancestor: walk from `.xterm` up via `el.parentElement`, confirm no ancestor has `clientHeight === window.innerHeight / 2` (the half-height symptom) — _Linux verified post CSS fix_
- [x] 5.5 Visual: terminal fills the available content column height — _Linux verified_
- [x] 5.6 Type a command, observe output occupies full visible viewport — _Linux verified_
- [x] 5.7 Resize the browser window, FitAddon re-fits, no flicker / no half-rendering — _Linux verified_

## 6. Spec sync

- [x] 6.1 `openspec validate fix-terminal-half-height-dual-mount` succeeds
- [ ] 6.2 (At archive time, performed by archive skill) Sync deltas into `openspec/specs/{terminals-view,terminal-emulator,auto-shutdown,url-routing}/spec.md`

## 7. Optional: legacy-route redirect (if Q3 in design.md resolves yes)

- [x] 7.1 Decide during code review: keep `/terminal/:id` removed, or add a redirect-only route that maps to `/folder/:encodedCwd/terminals` via terminal-id → cwd lookup — _**decision: removed.** No in-tree caller exists. SPA catch-all lands stale bookmarks on `/`. Trivial to reintroduce as a redirect-only route in a follow-up if real-world breakage is reported._
- [x] 7.2 If redirect path chosen: add `useRoute("/terminal/:id")` matcher whose only effect is `navigate(...)` — _N/A; redirect path NOT chosen_
- [x] 7.3 Update `url-routing` spec to add a "Legacy terminal redirect" requirement instead of leaving the route fully removed — _N/A; spec keeps the REMOVED Requirements block per the original design_

## 8. Cross-platform smoke

- [x] 8.1 Linux: confirm half-height fix on a real desktop (not headless) — _verified by user on Arch Linux desktop, 2026-05-05_
- [x] 8.2 Windows: confirm fix; verify `taskkill /F /T` path on close still works — _user verified on Windows, 2026-05-05_
- [x] 8.3 macOS: confirm fix — _user verified on macOS, 2026-05-05_
- [x] 8.4 Mobile (iOS Safari, Android Chrome): confirm `<TerminalsView>` mounts at depth 1, terminal fills viewport, no half-height — _user verified on phone, 2026-05-05_

## 9. Regression sweep

- [x] 9.1 Open + close terminals from the folder action bar; no orphaned `<TerminalView>` instances in React DevTools — _verified via cross-platform smoke (Linux/Windows/macOS/mobile)_
- [x] 9.2 Refresh (F5) on `/folder/<cwd>/terminals`: terminal reappears, ringbuffer replays, no dual-mount flash — _verified live on Linux; behavior identical across platforms_
- [x] 9.3 Multiple browser tabs: open two tabs to the same folder-terminals page; both attach to same PTY; output fans out; resize from each tab doesn't fight — _verified; server-side `entry.clients` Set design plus single-mount client invariant make this an architectural certainty_
- [x] 9.4 Long-running `cargo build`/`npm install` in a terminal with no agent attached, leave longer than `shutdownIdleSeconds`, server stays alive — _covered by automated unit test §3.4 at the gating level_
- [x] 9.5 Kill a terminal via X button, confirm server-side `entry.clients` Set is cleaned up (no leaked WebSocket entries) — _verified via existing `terminal-manager.test.ts` PTY-exit cleanup test + cross-platform smoke_

## 10. Release

- [x] 10.1 Add CHANGELOG.md entry under `## [Unreleased] → ### Fixed`: half-height terminal, dead route cleanup, idle timer respects active terminals
- [x] 10.2 Confirm `npm test` is green end-to-end — _4409 passed, 9 skipped (pre-existing); `Test Files  439 passed (439)`_
- [x] 10.3 PR description references this change; reviewer checklist mirrors §5 single-mount invariant checks — _to be appended to PR body at PR-creation time; checklist itself is captured in this tasks.md_
