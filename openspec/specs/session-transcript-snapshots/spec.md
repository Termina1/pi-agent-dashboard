# session-transcript-snapshots Specification

## Purpose
TBD - created by archiving change persist-cold-session-transcripts. Update Purpose after archive.
## Requirements
### Requirement: Transcript snapshots persist for inactive sessions
The dashboard server SHALL persist a transcript snapshot sidecar for each session file at the same path as the session `.jsonl` file with suffix `.snapshot.json`. The snapshot SHALL contain enough finalized chat state to hydrate an inactive session without replaying synthetic streaming events.

A snapshot SHALL include:
- `schemaVersion`
- `projectorVersion`
- `source.sessionFile`
- `source.size`
- `source.mtimeMs`
- `builtAt`
- finalized transcript state including `messages`, token/cost totals, model metadata, context usage, and file-change indicator

#### Scenario: Snapshot sidecar path
- **WHEN** a session file path is `/home/me/.pi/agent/sessions/repo/2026-id.jsonl`
- **THEN** the transcript snapshot path SHALL be `/home/me/.pi/agent/sessions/repo/2026-id.snapshot.json`

#### Scenario: Snapshot contains finalized messages
- **WHEN** a snapshot is written for an ended session
- **THEN** its transcript messages SHALL contain finalized chat messages and SHALL NOT require `message_update` or `message_end` replay to render assistant text

### Requirement: Snapshot freshness validation
The dashboard server SHALL treat a transcript snapshot as valid only when its `schemaVersion`, `projectorVersion`, source file size, and source file mtime match the current implementation and current `.jsonl` file metadata.

#### Scenario: Matching source metadata
- **WHEN** a snapshot's source size and mtime match the current `.jsonl` file and its versions are current
- **THEN** the server SHALL use the snapshot without parsing the `.jsonl` file

#### Scenario: Stale source metadata
- **WHEN** a snapshot's source size or mtime differs from the current `.jsonl` file
- **THEN** the server SHALL ignore the snapshot and rebuild it from the `.jsonl` file

#### Scenario: Old projector version
- **WHEN** a snapshot's `projectorVersion` differs from the current projector version
- **THEN** the server SHALL ignore the snapshot and rebuild it from the `.jsonl` file

### Requirement: Cold inactive sessions hydrate from snapshot
When a browser subscribes to an inactive session whose events are not present in the in-memory event buffer, the server SHALL hydrate the browser from a transcript snapshot instead of sending `event_replay` batches, when a valid snapshot exists or can be built.

#### Scenario: Cold session has valid snapshot
- **WHEN** a browser subscribes to an inactive session, `eventStore.hasEvents(sessionId)` is false, and a valid transcript snapshot exists
- **THEN** the server SHALL send one `session_snapshot` message for that session
- **AND** the server SHALL NOT send historical `event_replay` batches for that successful snapshot load

#### Scenario: Cold session snapshot built on demand
- **WHEN** a browser subscribes to an inactive session with no valid snapshot and a readable `.jsonl` file
- **THEN** the server SHALL build and persist a fresh transcript snapshot
- **AND** the server SHALL send one `session_snapshot` message after the build completes
- **AND** the server SHALL NOT progressively stream partial history as `event_replay` batches

#### Scenario: Snapshot build fails
- **WHEN** a browser subscribes to an inactive session whose snapshot is missing or stale and whose `.jsonl` file cannot be read or projected
- **THEN** the server SHALL mark the session `dataUnavailable: true`
- **AND** the server SHALL NOT stream a partial historical transcript

### Requirement: Warm and live sessions keep existing event stream
The snapshot path SHALL apply only to inactive cold sessions whose events are absent from the in-memory event buffer. Sessions with in-memory events SHALL continue to use the existing event and replay protocol so live updates, pending tools, prompts, and flow state behave unchanged.

#### Scenario: Warm inactive session remains event-based
- **WHEN** a browser subscribes to a session and `eventStore.hasEvents(sessionId)` is true
- **THEN** the server SHALL use the existing `event_replay` delta/full replay behavior for that in-memory buffer

#### Scenario: Live session remains event-based
- **WHEN** a connected bridge sends live `event_forward` messages
- **THEN** subscribed browsers SHALL continue receiving live `event` messages as before

### Requirement: Snapshot prewarm runs in background
After server startup discovers session files, the server SHALL enqueue background snapshot prewarm jobs for sessions with missing or stale transcript snapshots. Prewarm SHALL run without blocking server startup or browser connections and SHALL prefer more recently active sessions first.

#### Scenario: Startup queues stale snapshots
- **WHEN** the server starts and discovers ended sessions with missing or stale transcript snapshots
- **THEN** it SHALL enqueue background prewarm jobs for those sessions

#### Scenario: Startup remains non-blocking
- **WHEN** background prewarm is running
- **THEN** the dashboard server SHALL continue accepting browser connections and session actions

#### Scenario: Recent sessions first
- **WHEN** multiple sessions need prewarm
- **THEN** sessions with newer activity timestamps SHALL be processed before older sessions

### Requirement: Completed live turns refresh snapshots
When a live session reaches a safe completed-turn point, the server SHALL enqueue a snapshot refresh for that session file so future inactive opens can hydrate from disk without replay.

#### Scenario: Agent end schedules snapshot refresh
- **WHEN** the server processes a live `agent_end` event for a session with a known `sessionFile`
- **THEN** it SHALL enqueue a snapshot refresh for that session in the background

#### Scenario: Snapshot refresh does not block live event delivery
- **WHEN** a snapshot refresh is scheduled after `agent_end`
- **THEN** the server SHALL continue broadcasting the live event and session updates without waiting for the snapshot write to finish

