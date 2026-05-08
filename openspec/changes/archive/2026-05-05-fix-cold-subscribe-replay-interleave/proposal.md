## Why

`incremental-event-sync` currently scopes "suppress live events during replay" to the **delta** path (subscribe with `lastSeq > 0`). The **cold** path (`lastSeq = 0`, full replay of an existing in-memory event store) is not suppressed: live `event` broadcasts can interleave between paginated `event_replay` batches, bumping the client's per-session `maxSeqMap` past the next batch's `firstSeq`. The client's existing reset rule

```
shouldReset = firstSeq != null && (firstSeq === 1 || firstSeq <= maxSeq)
```

then misfires on the *next* replay batch (`firstSeq <= maxSeq` is true because a live event already advanced `maxSeq`), wipes the partially-built `SessionState`, and rebuilds from only that single batch. Net effect: the chat window shows only the events from the final replay batch — earlier user prompts, assistant turns, and tool results vanish.

Reproduction observed in session `019df32b-...`: 228 stored events split into 5 batches of 50; a live `flow:list-flows` event slipped between B2 and B3, bumping `maxSeq` from 50 → 107; B3 (`firstSeq=101`) tripped the reset; only events 101..105 survived. Sessions with noisy probe-event traffic (`flow:list-flows`, `flow:role-get-all`) trigger this reliably; quiet sessions hide it.

## What Changes

- Generalise the suppression rule in `incremental-event-sync`: live-event suppression SHALL apply to **every paginated replay**, not only delta replays. Concretely, drop the `lastSeq > 0` part of the guard in `subscription-handler.ts`'s `eventStore.hasEvents` branch — `markReplaying` now triggers whenever `events.length > 0`, regardless of whether the client started from `lastSeq=0` (cold) or `lastSeq>0` (warm).
- The existing `clearReplaying(ws, sessionId, lastSent)` catch-up mechanism (single `event_replay { isLast: true }` containing seqs > `lastSent`) handles any live events that arrived during the suppression window — no events are lost.
- Update the `incremental-event-sync` spec scenarios to reflect that suppression covers cold subscribes too. Add a regression scenario that pins the bug (live event between batches must not reach the client until replay completes).
- Update `dashboard-server` spec where its broadcastEvent contract references the per-WS replay flag — the contract is unchanged in code but the wording previously implied "delta only".

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `incremental-event-sync`: "Suppress live events during delta replay" requirement broadens to cover every paginated replay (cold + warm). Adds explicit out-of-order regression scenario.

## Impact

- Code: `packages/server/src/browser-handlers/subscription-handler.ts` (one-line guard change), `packages/server/src/__tests__/subscription-handler.test.ts` (flip an existing assertion that pinned the old buggy behaviour, add a regression test for the empty-events branch).
- No protocol change. No client code change. No persistence change. No migration. Old clients see the same wire format (an extra catch-up `event_replay { isLast: true }` after the paginated stream when no late events accumulated, with `events: []` — already legal per protocol).
- Rollback: revert the diff in `subscription-handler.ts`. No data to migrate.
- Compatibility: backward-compatible with all clients ≤ current. Forward-compatible.
