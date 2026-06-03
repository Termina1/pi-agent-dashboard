## ADDED Requirements

### Requirement: Session snapshot browser protocol message
The server-to-browser protocol SHALL include a `session_snapshot` message type used to hydrate finalized transcript state for cold inactive sessions without replaying historical event batches.

The message SHALL include:
- `type: "session_snapshot"`
- `sessionId: string`
- `snapshot.schemaVersion: number`
- `snapshot.projectorVersion: number`
- `snapshot.source.size: number`
- `snapshot.source.mtimeMs: number`
- `snapshot.builtAt: number`
- `snapshot.transcript.messages`
- `snapshot.transcript` token/cost totals and optional model/context fields

`SessionSnapshotMessage` SHALL be included in the `ServerToBrowserMessage` union.

#### Scenario: Message type definition
- **WHEN** the browser protocol types are compiled
- **THEN** `SessionSnapshotMessage` SHALL be a valid TypeScript interface with `type: "session_snapshot"`, `sessionId`, and `snapshot` fields

#### Scenario: Union type inclusion
- **WHEN** `ServerToBrowserMessage` union is checked
- **THEN** it SHALL include `SessionSnapshotMessage`

#### Scenario: Client hydrates snapshot atomically
- **WHEN** the browser receives a `session_snapshot` message
- **THEN** it SHALL replace that session's `SessionState` with a state hydrated from `snapshot.transcript` in a single state update
- **AND** the hydrated state SHALL have no active `streamingText`
