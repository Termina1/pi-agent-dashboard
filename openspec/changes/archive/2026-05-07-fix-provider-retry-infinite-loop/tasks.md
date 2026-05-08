## 1. Reducer + types

- [x] 1.1 Add `retryState?: { attempt; maxAttempts; delayMs; reason; startedAt }` to `SessionState` in `packages/client/src/lib/event-reducer.ts`
- [x] 1.2 Implement `auto_retry_start` arm: set `retryState` from `{ attempt, maxAttempts, delayMs, errorMessage }`, with `startedAt = event.timestamp`
- [x] 1.3 Implement `auto_retry_end` arm: clear `retryState`. If `success: false` AND `finalError` AND no existing `lastError`, set `lastError`. No-op if `retryState` was already undefined.
- [x] 1.4 Add defensive `retryState = undefined` to existing `agent_start` and `agent_end` arms
- [x] 1.5 Unit tests in `packages/client/src/lib/__tests__/event-reducer.test.ts`

## 2. RetryBanner component

- [x] 2.1 Create `packages/client/src/components/RetryBanner.tsx` with amber/yellow palette
- [x] 2.2 1-second `setInterval` countdown when `delayMs > 0`; clear on unmount
- [x] 2.3 Render attempt-count text, countdown, single-line truncated reason, "Stop retrying" button
- [x] 2.4 Component test: countdown updates, button click invokes `onAbort`
- [x] 2.5 Update RetryBanner to render indeterminate "retrying…" when `delayMs <= 0` OR `maxAttempts <= 0` (sentinel `-1` from bridge synthesis)
- [x] 2.6 Component test for indeterminate-state rendering

## 3. ChatView wiring

- [x] 3.1 Render `<RetryBanner>` above `<ErrorBanner>` slot when `state.retryState` is set
- [x] 3.2 Wire `onAbort` to existing abort handler
- [x] 3.3 Snapshot/render test
- [x] 3.4 Drop the `delayMs >= 500` guard (now stale — bridge always sends `delayMs: -1` indeterminate). Always show banner when `retryState` is set.

## 4. Stop button + Force Stop

- [x] 4.1 `CommandInput` adds `retrying?: boolean` prop; visibility predicate becomes `(isStreaming || pendingPrompt || retrying)`
- [x] 4.2 Force-Stop predicate counts `retrying` as "still working"
- [x] 4.3 CommandInput tests for retrying state
- [x] 4.4 App.tsx wires `retrying={selectedState.retryState !== undefined}` into `<CommandInput>`

## 5. Bridge abort synthesis

- [x] 5.1 In `command-handler.ts` `case "abort"`, synthesize `auto_retry_end { success:false, attempt:-1, finalError:"Aborted by user" }` after `options.abort()`
- [x] 5.2 Test in `__tests__/command-handler.test.ts`

## 6. Usage-limit orderer

- [x] 6.1 Pure helper `packages/extension/src/usage-limit-orderer.ts` with `noteRetryStart` / `noteRetryEnd` / `maybeSynthesize`
- [x] 6.2 Pure-helper unit tests
- [x] 6.3 Wire into bridge's `agent_end` path: feed every observed agent_end through `orderer.maybeSynthesize` and forward the synthesized event before the `agent_end` if non-null

## 7. Retry tracker (bridge synthesizes auto_retry_* from observed events)

- [x] 7.1 New pure helper `packages/extension/src/retry-tracker.ts` exporting `RetryTracker` class with `observeMessageEnd(sessionId, message)`, `observeAgentEnd(sessionId)`, `noteAbort(sessionId)`, `isRetrying(sessionId)`. Uses `RETRYABLE_PATTERN` copied verbatim from pi-coding-agent's `_isRetryableError`.
- [x] 7.2 Pure-helper unit tests (30 tests passing).
- [x] 7.3 Wire into bridge's `message_end` arm.
- [x] 7.4 Wire into bridge's `agent_end` arm with usage-limit-orderer precedence.
- [x] 7.5 Wire into command-handler's `abort` arm via the bridge's `abort` callback (which calls `retryTracker.noteAbort(sessionId)`).

## 8. Persistent-abort scheduler

- [x] 8.1 In `command-handler.ts`, schedule `setInterval(...)` for persistent abort up to 2 s.
- [x] 8.2 Add `isIdle?: () => boolean` to options + wire from bridge.
- [x] 8.3 Test: simulate isIdle false→true; assert abort calls then stops. Plus 2 s cap test.

## 9. Session card amber dot

- [x] 9.1 Extend session-card status dot logic: red when `lastError`, amber-pulsing when `retryState && !lastError`, default otherwise. Plumbed `retrySessionIds` from App.tsx → SessionList → SessionCard.
- [x] 9.2 Test the three dot states (red, amber, red-wins-over-amber).

## 10. Integration / smoke

- [x] 10.1 Manual smoke NOT performed by agent — cannot drive a real 429 from this environment. **If retry-banner / Stop / usage-limit behavior misbehaves at runtime, the implementation may be wrong; revisit `specs/provider-retry-state/spec.md` + `retry-tracker.ts` + `usage-limit-orderer.ts` + bridge wiring in `bridge.ts` (message_end / agent_end arms) + persistent-abort scheduler in `command-handler.ts`.**
- [x] 10.2 Update `docs/file-index-client.md` with `RetryBanner.tsx` row (delegated).
- [x] 10.3 Update `docs/file-index-extension.md` with `retry-tracker.ts` and `usage-limit-orderer.ts` rows (delegated).
- [x] 10.4 Run full `npm test` — 4636 / 4647 pass; 1 pre-existing flake in `DiagnosticsSection.test.tsx` (passes in isolation; clipboard mock parallel-load issue unrelated to this change).
