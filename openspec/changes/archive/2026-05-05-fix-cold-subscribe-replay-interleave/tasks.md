## 1. Tests (TDD)

- [x] 1.1 In `packages/server/src/__tests__/subscription-handler.test.ts`, flip the existing assertion `does not mark replaying for fresh subscribe (lastSeq: 0)` — it pins the old buggy behaviour. New assertion: `marks replaying for fresh subscribe (lastSeq: 0) when events exist`, expecting `markReplaying(ws, "s1")` and `clearReplaying(ws, "s1", lastSent)`.
- [x] 1.2 Add a sibling test `does not mark replaying for fresh subscribe when there are no events` to pin that the empty-events branch (no `eventStore.hasEvents`) still does not call `markReplaying`.
- [x] 1.3 Verify both tests fail before the implementation change and pass after.

## 2. Implementation

- [x] 2.1 In `packages/server/src/browser-handlers/subscription-handler.ts`, change the suppression guard in the `eventStore.hasEvents` branch from `if (lastSeq > 0 && events.length > 0)` to `if (events.length > 0)`. Update the surrounding comment to explain the cold-subscribe interleave failure mode and reference this change.
- [x] 2.2 Run `HOME=$(mktemp -d) npx vitest run packages/server/src/__tests__/subscription-handler.test.ts` and confirm all 13 tests pass.
- [x] 2.3 Run the full suite: `npm test 2>&1 | tee /tmp/pi-test.log` and confirm no regressions outside this scope (one pre-existing failure in `no-raw-openspec-status-in-skills.test.ts` is unrelated).
- [x] 2.4 `npm run build` and `curl -X POST http://localhost:8000/api/restart`; manual verify the previously-broken session renders the full chat history.

## 3. Spec sync & verification

- [x] 3.1 In `openspec/changes/fix-cold-subscribe-replay-interleave/specs/incremental-event-sync/spec.md`, replace the `Suppress live events during delta replay` requirement with a broader version covering cold + warm subscribes; add a regression scenario for the live-event-between-batches case.
- [x] 3.2 Run `openspec validate fix-cold-subscribe-replay-interleave --strict` and resolve any warnings.
- [x] 3.3 Confirm that the existing scenarios under that requirement remain accurate; update wording where they mention "delta replay" if the new semantics apply equally to cold replays.

## 4. Docs

- [x] 4.1 No `AGENTS.md` change. The fix is internal to one server module; the architectural backbone wording is unchanged.
- [x] 4.2 Add a one-line change-history annotation to the `subscription-handler.ts` row in `docs/file-index-server.md` (caveman style): `See change: fix-cold-subscribe-replay-interleave`.

## 5. Follow-up (out of scope, flagged only)

- [x] 5.1 Investigate the bridge probe loop emitting `flow:list-flows` (98×) and `flow:role-get-all` (27×) per session — likely in `packages/extension/src/bridge.ts:164` and `command-handler.ts:302,388`. These bloat the in-memory event store and the client's `rawEvent` rows. Track in a separate change.
