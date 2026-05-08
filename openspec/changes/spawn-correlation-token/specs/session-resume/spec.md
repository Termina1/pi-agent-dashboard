## MODIFIED Requirements

### Requirement: Resume/fork protocol messages
The browser SHALL send a `resume_session` message to the server specifying the session ID and mode (`"continue"` or `"fork"`). The browser SHALL include an optional `requestId: string` (UUIDv4) for client-side correlation of the eventual result. The server SHALL look up the session file and spawn pi accordingly.

The server SHALL respond with a `resume_result` message echoing the `requestId` (when provided) and including a `newSessionId: string` field for `mode: "fork"` once the forked session has been correlated to its bridge registration. For `mode: "continue"`, `newSessionId` SHALL be omitted (the sessionId is preserved across the respawn).

For `mode: "fork"`, the implementation MAY surface the new sessionId either by (a) deferring `resume_result` emission until the bridge has registered and including `newSessionId` in that single message, OR (b) emitting `resume_result` immediately on spawn success and relying on the eventual `session_added { spawnRequestId }` broadcast (whose `spawnRequestId` matches the fork's `requestId`) to deliver the new sessionId. Implementations SHALL pick exactly one strategy.

#### Scenario: Continue mode
- **WHEN** the browser sends `resume_session` with `mode: "continue"` and `sessionId`
- **THEN** the server SHALL look up the `session_file` for that session and spawn `pi --session <path>`

#### Scenario: Fork mode
- **WHEN** the browser sends `resume_session` with `mode: "fork"` and `sessionId`
- **THEN** the server SHALL look up the `session_file` for that session and spawn `pi --fork <path>`

#### Scenario: Continue spawn result reported to browser
- **WHEN** the server completes a `mode: "continue"` resume
- **THEN** it SHALL send a `resume_result` to the requesting browser with `success: boolean`, `message: string`, and (when input had `requestId`) the echoed `requestId`
- **AND** the message SHALL NOT include `newSessionId`

#### Scenario: Fork spawn result delivers new sessionId
- **WHEN** the server completes a `mode: "fork"` resume successfully and the new bridge registers
- **THEN** the new (forked) sessionId SHALL be delivered to the browser via EITHER `resume_result.newSessionId` OR `session_added.spawnRequestId` matching the input `requestId`
- **AND** in either case, no cwd-based inference SHALL be required by the client

#### Scenario: Fork failure preserves requestId echo
- **WHEN** the server fails a `mode: "fork"` resume (preflight, spawn-errno, etc.)
- **THEN** it SHALL send `resume_result` with `success: false`, `message: <reason>`, and the echoed `requestId`
- **AND** the message SHALL NOT include `newSessionId`

#### Scenario: Legacy client without requestId
- **WHEN** an older client sends `resume_session` without `requestId`
- **THEN** the server SHALL process the message normally
- **AND** the emitted `resume_result` SHALL NOT include a `requestId` field
- **AND** for `mode: "fork"`, the client SHALL fall back to its previous cwd-based heuristic (existing pre-change behavior)
