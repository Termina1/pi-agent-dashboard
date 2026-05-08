## ADDED Requirements

### Requirement: Fork on empty session silently degrades to a fresh spawn
When the browser issues `resume_session { mode: "fork" }` (or the REST endpoint receives an equivalent request) AND the source session's `sessionFile` does not exist on disk, the server SHALL silently degrade to a fresh spawn in the source's `cwd`. The degradation SHALL:

1. Verify `existsSync(session.sessionFile)` returns false BEFORE invoking `spawnPiSession`.
2. If the source session has a non-empty `attachedProposal`, enqueue it in `pendingAttachRegistry` keyed by `session.cwd` so the new spawn inherits the attachment.
3. Invoke `spawnPiSession(session.cwd, { strategy })` with NO `sessionFile` and NO `mode` field — i.e., a fresh spawn rather than a fork or continue.
4. Register the resulting PID + spawnToken in `headlessPidRegistry` exactly as a normal spawn would.
5. Record the requestId↔spawnToken correlation in `pendingClientCorrelations` (when both are present) so the eventual `session_added` carries `spawnRequestId`.
6. Send a `resume_result` (or REST response) with `success: result.success`, an informational `message` explaining the degradation, the echoed `requestId`, and `code: "FORK_DEGRADED_TO_NEW"` (only set on success — failure returns the spawn's own error code if any).

The user-facing message SHALL be along the lines of `"Started a fresh session — the source had no persisted history to fork from."` or equivalently informative text.

The check applies ONLY to `mode: "fork"`. The `mode: "continue"` path SHALL be unchanged.

#### Scenario: Fork on session with no persisted JSONL spawns fresh in same cwd
- **GIVEN** the dashboard has session `S` with `cwd: "/proj"`, `sessionFile: "/proj/.pi/missing.jsonl"`, no `attachedProposal`
- **AND** `existsSync("/proj/.pi/missing.jsonl")` returns false
- **WHEN** the browser sends `resume_session { sessionId: "S", mode: "fork", requestId: "rq" }`
- **THEN** the server SHALL invoke `spawnPiSession("/proj", { strategy })` (no sessionFile, no mode)
- **AND** SHALL emit `resume_result { sessionId: "S", success: true, code: "FORK_DEGRADED_TO_NEW", requestId: "rq", message: <fresh-session-message> }` once spawn succeeds
- **AND** SHALL register the new PID in `headlessPidRegistry`
- **AND** SHALL record the requestId↔spawnToken correlation
- **AND** the legacy `pendingForkRegistry.recordFork(token, parentSessionId)` SHALL NOT be called for this path
- **AND** no spawn-failure-log entry SHALL be appended

#### Scenario: Degraded fork inherits parent's attachedProposal
- **GIVEN** session `S` has `attachedProposal: "feature-x"` and `existsSync(sessionFile)` is false
- **WHEN** the browser sends `resume_session { sessionId: "S", mode: "fork" }`
- **THEN** the server SHALL enqueue `("feature-x", S.cwd)` in `pendingAttachRegistry` BEFORE calling `spawnPiSession`
- **AND** when the new pi process registers, the existing pending-attach pipeline SHALL apply `feature-x` to the new session

#### Scenario: REST fork on missing JSONL returns 200 with degradation code
- **WHEN** an HTTP client posts `{ "mode": "fork" }` to `/api/session/:id/resume` for a session whose `sessionFile` does not exist on disk
- **THEN** the server SHALL respond with HTTP 200 and body `{ success: true, data: { message: <fresh-session-message> }, code: "FORK_DEGRADED_TO_NEW" }`
- **AND** SHALL NOT respond with HTTP 409 or any 4xx/5xx for this case

#### Scenario: Fork on session with persisted JSONL is unaffected
- **GIVEN** session `S` whose `sessionFile` exists on disk
- **WHEN** the browser sends `resume_session { sessionId: "S", mode: "fork" }`
- **THEN** the server SHALL invoke the existing fork flow (`pi --fork <path>`, `pendingForkRegistry.recordFork`, etc.)
- **AND** the response code SHALL NOT include `FORK_DEGRADED_TO_NEW`

#### Scenario: Continue mode is unaffected by the degradation
- **WHEN** the browser sends `resume_session { sessionId: "S", mode: "continue" }`
- **THEN** the new fork preflight SHALL NOT run
- **AND** existing continue-mode validation (session is ended, sessionFile is set) SHALL apply as before

#### Scenario: Spawn failure on degraded path surfaces normally
- **GIVEN** the server takes the degraded path AND `spawnPiSession` returns `{ success: false, message: <reason>, code: "DIR_MISSING" }`
- **WHEN** the response is sent
- **THEN** `resume_result.success` SHALL be `false`
- **AND** `resume_result.message` SHALL carry the spawn failure message
- **AND** `resume_result.code` SHALL NOT be `"FORK_DEGRADED_TO_NEW"` (the degradation didn't complete)

### Requirement: `resume_result` carries optional `code` field
The `ResumeResultBrowserMessage` (server → browser) SHALL include an optional `code?: string` field. When set, it SHALL be a structured failure-or-status classifier string. Known values include `"FORK_DEGRADED_TO_NEW"` for the silent-degradation path. Old clients that do not read the field SHALL continue to function on the existing `message` string alone.

```ts
export interface ResumeResultBrowserMessage {
  type: "resume_result";
  sessionId: string;
  success: boolean;
  message: string;
  requestId?: string;
  newSessionId?: string;
  code?: string; // NEW
}
```

#### Scenario: Code field type-checks
- **WHEN** the protocol type is referenced in TypeScript
- **THEN** `code: string | undefined` SHALL be allowed on `ResumeResultBrowserMessage`

#### Scenario: Old clients ignore the code
- **WHEN** an older client (pre-this-change) receives `resume_result` with a `code` field
- **THEN** it SHALL parse and process the message normally, using only `message` and `success` for display

### Requirement: `ApiResponse` REST envelope carries optional `code` field
The `ApiResponse` shared envelope SHALL include an optional `code?: string` field so REST handlers can emit structured codes alongside `error`/`success`.

```ts
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string; // NEW
}
```

#### Scenario: REST endpoint emits a structured code
- **WHEN** `/api/session/:id/resume` takes the degradation path on success
- **THEN** the response body SHALL include `code: "FORK_DEGRADED_TO_NEW"`

#### Scenario: REST clients without code awareness still work
- **WHEN** an older REST client parses the response
- **THEN** it SHALL read `success` and `data.message` as before; the extra `code` SHALL not cause parse failures
