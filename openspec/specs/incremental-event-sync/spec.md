## Purpose

Minimizes data transfer between server and browser by using delta event replay instead of full replay on every reconnect. The browser tracks the highest received sequence number per session and sends it on subscribe; the server returns only new events. The bridge sends entry counts so the server can skip wiping the event store on reconnect when the session hasn't changed.

## ADDED Requirements

### Requirement: Client-side sequence tracking
The browser client SHALL maintain a `maxSeqMap: Map<string, number>` that tracks the highest event sequence number received per session. The map SHALL be updated on every `event` message (from `msg.seq`) and every `event_replay` batch (from the last event's `seq` in the batch).

#### Scenario: Live event updates maxSeq
- **WHEN** the browser receives an `event` message with `sessionId: "s1"` and `seq: 42`
- **THEN** `maxSeqMap.get("s1")` SHALL be updated to `42` (if greater than current value)

#### Scenario: Replay batch updates maxSeq
- **WHEN** the browser receives an `event_replay` message with events `[{seq:10,...}, {seq:11,...}, {seq:12,...}]`
- **THEN** `maxSeqMap` for that session SHALL be updated to `12`

#### Scenario: Empty replay does not reset maxSeq
- **WHEN** the browser receives an `event_replay` with an empty events array
- **THEN** `maxSeqMap` for that session SHALL remain unchanged

### Requirement: Delta subscribe using lastSeq
The browser client SHALL send the tracked `maxSeq` as `lastSeq` when subscribing to a session. The server SHALL return only events with `seq > lastSeq`.

#### Scenario: Re-subscribe after reconnect with existing state
- **WHEN** the browser reconnects and re-subscribes to session "s1" with `maxSeqMap.get("s1") === 50`
- **THEN** the subscribe message SHALL include `lastSeq: 50`
- **AND** the server SHALL return only events with `seq > 50`

#### Scenario: First-time subscribe
- **WHEN** the browser subscribes to a session not in `maxSeqMap`
- **THEN** the subscribe message SHALL include `lastSeq: 0` (full replay)

### Requirement: Reset seq on session_state_reset
When the browser receives a `session_state_reset` message for a session, it SHALL reset that session's entry in `maxSeqMap` to `0` and clear the session's `SessionState` (existing behavior). The next event replay from the server will be a full replay.

#### Scenario: Bridge reconnect triggers reset
- **WHEN** the browser receives `session_state_reset` for session "s1"
- **THEN** `maxSeqMap.get("s1")` SHALL be reset to `0`
- **AND** the session's `SessionState` SHALL be reset to initial state

### Requirement: Server detects stale lastSeq
When a browser subscribes with `lastSeq` greater than the server's highest stored seq for that session, the server SHALL send `session_state_reset` followed by a full replay from seq 1.

#### Scenario: Client has higher seq than server (server restarted)
- **WHEN** browser subscribes with `lastSeq: 500` but server's max stored seq for that session is `10`
- **THEN** server SHALL send `session_state_reset` for that session
- **AND** server SHALL replay all events from seq 1

#### Scenario: Client lastSeq within server range
- **WHEN** browser subscribes with `lastSeq: 50` and server has events up to seq `100`
- **THEN** server SHALL replay events with seq 51–100 (no reset needed)

### Requirement: Bridge event count for skip-wipe detection
The bridge extension SHALL include an `eventCount` field in the `session_register` message, representing the number of conversation entries in the current session. The server SHALL store this as `lastEntryCount` on the `DashboardSession` and compare against it on subsequent reconnects to decide whether to wipe the event store.

#### Scenario: Event count matches — skip wipe
- **WHEN** bridge reconnects with `session_register { sessionId: "s1", eventCount: 200 }` and the server's stored `lastEntryCount` for session "s1" is `200` and events exist in the event store
- **THEN** the server SHALL NOT call `deleteEventsForSession("s1")`
- **AND** the server SHALL NOT send `session_state_reset` to browsers
- **AND** the server SHALL clear the `replayingSessions` flag after receiving `replay_complete`

#### Scenario: Event count mismatch — full wipe
- **WHEN** bridge reconnects with `session_register { sessionId: "s1", eventCount: 150 }` but the server's stored `lastEntryCount` for "s1" is `200`
- **THEN** the server SHALL call `deleteEventsForSession("s1")`
- **AND** the server SHALL send `session_state_reset` to browser subscribers

#### Scenario: No eventCount provided — full wipe (backward compat)
- **WHEN** bridge reconnects with `session_register` without `eventCount`
- **THEN** the server SHALL perform the existing full wipe behavior

#### Scenario: Session ID changed — always full wipe
- **WHEN** bridge reconnects with a different `sessionId` than previously registered on the same WebSocket
- **THEN** the server SHALL perform the full wipe regardless of `eventCount`

### Requirement: Suppress live events during paginated replay

When the server sends a paginated `event_replay` stream to a browser WebSocket — whether the subscribe was cold (`lastSeq: 0`, full replay of all stored events) or warm (`lastSeq > 0`, delta replay of seqs `> lastSeq`) — it SHALL suppress live `event` broadcasts to that specific WebSocket until the replay completes. Suppression applies whenever the server has a non-empty event set to replay (`events.length > 0`).

This rule exists because the client's `event_replay` reset rule

```
shouldReset = firstSeq != null && (firstSeq === 1 || firstSeq <= maxSeq)
```

uses a single per-session `maxSeq` that is bumped by both `event_replay` batches AND live `event` messages. If a live `event` interleaves between two paginated `event_replay` batches it advances `maxSeq` past the next batch's `firstSeq`, causing the next batch to misfire `shouldReset = true`, wipe the partially-built `SessionState`, and rebuild from only that batch's events. Net effect: the chat shows only the tail. Suppression+catch-up preserves the invariant that paginated `event_replay` batches arrive monotonically with no live-event interleaving on the same WebSocket.

#### Scenario: Cold subscribe with stored events suppresses live broadcasts (regression)
- **WHEN** browser B subscribes to session "s1" with `lastSeq: 0` and the in-memory event store holds 228 events for "s1"
- **AND** the server begins sending paginated `event_replay` batches (50 per batch)
- **AND** a new live event with `seq: 105` arrives after batch B2 (`firstSeq=51, lastSeq=100`) but before batch B3 (`firstSeq=101`)
- **THEN** the server SHALL NOT send `event { seq: 105 }` to browser B until the paginated replay has completed (`isLast: true` sent)
- **AND** browser B's `maxSeqMap.get("s1")` SHALL NOT be advanced past `100` before batch B3 (`firstSeq=101`) arrives
- **AND** batch B3 SHALL NOT trigger the `shouldReset` rule on the client

#### Scenario: Warm subscribe (delta) live event during replay is suppressed
- **WHEN** browser B subscribes to session "s1" with `lastSeq: 50` and the server starts replaying events 51..100
- **AND** a new live event with `seq: 101` arrives during the replay
- **THEN** the server SHALL NOT send `event { seq: 101 }` to browser B until the replay batch with `isLast: true` has been sent
- **AND** after replay completes, the server SHALL resume live broadcasting to browser B
- **AND** the server SHALL send event 101 to browser B (either as part of a catch-up `event_replay` if it falls within range, or as a live event after replay)

#### Scenario: Other browsers not replaying receive live events immediately
- **WHEN** browser A is subscribed and not replaying, and browser B is mid-replay (cold or warm)
- **AND** a new live event arrives
- **THEN** the server SHALL broadcast the event to browser A immediately
- **AND** the server SHALL suppress the event for browser B until B's replay completes

#### Scenario: Events during suppression are not lost — catch-up batch
- **WHEN** events with seqs 229, 230, 231 arrive while browser B is mid-replay (cold subscribe, paginated through seqs 1..228)
- **THEN** all three events SHALL be stored in the event store
- **AND** after the paginated replay completes, the server SHALL send events 229..231 to browser B as a single `event_replay { isLast: true }` catch-up batch (via `clearReplaying(ws, sessionId, lastSent)`)

#### Scenario: Empty event set — no suppression marker set
- **WHEN** browser B subscribes to a session whose event store exists but is empty (`events.length === 0` for the subscribe range)
- **THEN** the server SHALL NOT call `markReplaying` for that WebSocket+session pair
- **AND** any subsequent live `event` SHALL be broadcast to browser B immediately
