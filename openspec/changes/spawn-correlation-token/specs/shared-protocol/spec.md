## ADDED Requirements

### Requirement: `session_register` carries optional `spawnToken`
The `SessionRegisterMessage` (extension → server) SHALL include an optional `spawnToken?: string` field. The bridge SHALL populate this field with `process.env.PI_DASHBOARD_SPAWN_TOKEN` IFF `bc.hasRegisteredOnce === false` at the time of the register. The bridge SHALL omit the field on every subsequent register (reattach, in-process session change). The server SHALL accept messages where the field is absent and treat them as legacy.

The protocol type SHALL be:

```ts
export interface SessionRegisterMessage {
  type: "session_register";
  sessionId: string;
  cwd: string;
  // ... existing fields ...
  pid?: number;
  registerReason?: "spawn" | "reattach";
  spawnToken?: string; // NEW
}
```

#### Scenario: TypeScript type includes spawnToken
- **WHEN** `SessionRegisterMessage` is referenced in TypeScript
- **THEN** the type SHALL allow `spawnToken: string | undefined`

#### Scenario: First-register message includes spawnToken
- **WHEN** a bridge boots in a pi process where `PI_DASHBOARD_SPAWN_TOKEN` is set and `sendStateSync` runs for the first time
- **THEN** the wire message SHALL contain a `spawnToken` field equal to the env-var value

#### Scenario: Reattach message omits spawnToken
- **WHEN** the bridge reconnects after dashboard restart and resends `session_register`
- **THEN** the wire message SHALL NOT contain a `spawnToken` field

#### Scenario: Legacy bridge produces messages without spawnToken
- **WHEN** an older bridge that pre-dates this change emits `session_register`
- **THEN** the message SHALL parse and process without error
- **AND** the server SHALL fall through to pid-link or cwd-FIFO

### Requirement: `spawn_session` browser message carries optional `requestId`
The `SpawnSessionBrowserMessage` (browser → server) SHALL include an optional `requestId?: string` field. The client SHALL populate this with a freshly-minted UUIDv4 on every dispatch. The server SHALL accept absent values for backwards compatibility.

```ts
export interface SpawnSessionBrowserMessage {
  type: "spawn_session";
  cwd: string;
  attachProposal?: string;
  initialPrompt?: string;
  requestId?: string; // NEW
}
```

#### Scenario: TypeScript type includes requestId
- **WHEN** `SpawnSessionBrowserMessage` is referenced in TypeScript
- **THEN** the type SHALL allow `requestId: string | undefined`

#### Scenario: New client always includes requestId
- **WHEN** the client dispatches `spawn_session` via the upgraded `useSessionActions.handleSpawnSession`
- **THEN** the wire message SHALL contain a `requestId` field with a UUIDv4 value

#### Scenario: Legacy client message accepted
- **WHEN** an older client dispatches `spawn_session` without `requestId`
- **THEN** the server SHALL process the message normally (no echo will be possible, but spawn proceeds)

### Requirement: `resume_session` browser message carries optional `requestId`
The `ResumeSessionBrowserMessage` (browser → server) SHALL include an optional `requestId?: string` field with the same semantics as for `spawn_session`.

```ts
export interface ResumeSessionBrowserMessage {
  type: "resume_session";
  sessionId: string;
  mode: "continue" | "fork";
  entryId?: string;
  placement?: "front" | "keep";
  requestId?: string; // NEW
}
```

#### Scenario: TypeScript type includes requestId
- **WHEN** `ResumeSessionBrowserMessage` is referenced in TypeScript
- **THEN** the type SHALL allow `requestId: string | undefined`

#### Scenario: Resume dispatch always includes requestId
- **WHEN** the upgraded client dispatches `resume_session` for any mode
- **THEN** the wire message SHALL contain a UUIDv4 `requestId` field

### Requirement: `spawn_result` echoes `requestId` and may include `pid`
The `SpawnResultBrowserMessage` (server → browser) SHALL include an optional `requestId?: string` and an optional `pid?: number` field. When the input `spawn_session` carried a `requestId`, the server SHALL echo it. The `pid` SHALL be included when the spawn produced a tracked PID (headless strategy).

```ts
export interface SpawnResultBrowserMessage {
  type: "spawn_result";
  cwd: string;
  success: boolean;
  message: string;
  requestId?: string; // NEW
  pid?: number;       // NEW (informational only)
}
```

#### Scenario: TypeScript type includes requestId and pid
- **WHEN** `SpawnResultBrowserMessage` is referenced in TypeScript
- **THEN** both `requestId: string | undefined` and `pid: number | undefined` SHALL be allowed

#### Scenario: requestId echoed when input had one
- **WHEN** the server processes `spawn_session { cwd: "/p", requestId: "rq_1" }` and emits a result
- **THEN** the emitted `spawn_result` SHALL include `requestId: "rq_1"`

#### Scenario: requestId omitted when input lacked one
- **WHEN** the server processes a legacy `spawn_session` without `requestId`
- **THEN** the emitted `spawn_result` SHALL NOT include a `requestId` field

### Requirement: `resume_result` echoes `requestId` and includes `newSessionId` for fork mode
The `ResumeResultBrowserMessage` (server → browser) SHALL include optional `requestId?: string` and `newSessionId?: string` fields. The `requestId` SHALL be echoed when the input `resume_session` carried one. The `newSessionId` SHALL be populated for `mode: "fork"` ONLY after the forked session's bridge has registered and the server has correlated it via `linkByToken` / `linkByPid` / `linkSession`. For `mode: "continue"`, `newSessionId` SHALL be omitted (the sessionId is unchanged).

The server MAY emit the `resume_result` immediately after `spawnPiSession` returns (without `newSessionId`) and MAY emit a follow-up message — or, alternatively, the client SHALL correlate the new session by `session_added.spawnRequestId`. Implementations SHALL pick exactly one of these two strategies; both MUST surface the new sessionId to the client without requiring cwd-based heuristics.

```ts
export interface ResumeResultBrowserMessage {
  type: "resume_result";
  sessionId: string;
  success: boolean;
  message: string;
  requestId?: string;     // NEW
  newSessionId?: string;  // NEW (fork mode only, populated after link)
}
```

#### Scenario: TypeScript type includes new fields
- **WHEN** `ResumeResultBrowserMessage` is referenced in TypeScript
- **THEN** `requestId: string | undefined` and `newSessionId: string | undefined` SHALL both be allowed

#### Scenario: Continue mode result omits newSessionId
- **WHEN** the server processes `resume_session { mode: "continue" }` and emits a result on success
- **THEN** the emitted `resume_result` SHALL NOT include `newSessionId`

#### Scenario: Fork mode result either populates newSessionId or relies on session_added
- **WHEN** the server processes `resume_session { mode: "fork", requestId: "rq_x" }` successfully
- **THEN** EITHER the emitted `resume_result` SHALL include both `requestId: "rq_x"` and `newSessionId` set to the freshly-minted forked session id (deferred-emit strategy)
- **OR** the client SHALL receive `session_added { session, spawnRequestId: "rq_x" }` carrying the new sessionId (broadcast strategy)
- **AND** in either case, no cwd-based inference SHALL be required

### Requirement: `session_added` browser message includes optional `spawnRequestId`
The `session_added` browser message SHALL include an optional `spawnRequestId?: string` field. The server SHALL populate this field when the new session was correlated to a client-issued `requestId` (via the `pendingClientCorrelations` map). For server-initiated spawns (auto-resume, headless reload, etc.) where no client `requestId` exists, the field SHALL be omitted.

#### Scenario: TypeScript type includes spawnRequestId
- **WHEN** the `session_added` message type is referenced in TypeScript
- **THEN** `spawnRequestId: string | undefined` SHALL be allowed on the message shape

#### Scenario: Browser-spawned session carries spawnRequestId
- **WHEN** a session is created in response to a browser `spawn_session { requestId: "rq_42" }`
- **THEN** the `session_added` broadcast SHALL include `spawnRequestId: "rq_42"`

#### Scenario: Server-spawned session omits spawnRequestId
- **WHEN** auto-resume-on-prompt creates a session (no browser `requestId`)
- **THEN** the `session_added` broadcast SHALL NOT include `spawnRequestId`

#### Scenario: Legacy server omits the field entirely
- **WHEN** a pre-change server emits `session_added`
- **THEN** the message SHALL parse on a new client (the field is optional)
- **AND** the client SHALL NOT crash; auto-select SHALL fall through to no-op
