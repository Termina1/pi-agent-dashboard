## ADDED Requirements

### Requirement: Server mints a `spawnToken` for every spawn invocation
The server SHALL mint a UUIDv4 (`crypto.randomUUID()`) `spawnToken` for every call to `spawnPiSession()`, regardless of strategy (`tmux`, `wt`, `wsl-tmux`, `headless`) and regardless of trigger (`spawn_session`, `resume_session`, auto-resume-on-prompt, headless reload, jj workspace operations). The token SHALL be passed to `spawnPiSession` (or generated inside it) and SHALL be used to populate every registry entry related to that spawn invocation.

#### Scenario: Token minted on browser-initiated spawn
- **WHEN** `handleSpawnSession` invokes `spawnPiSession(cwd, opts)`
- **THEN** a unique `spawnToken` SHALL be generated using `crypto.randomUUID()`
- **AND** the token SHALL be attached to the `headlessPidRegistry` entry created for the spawned PID (when applicable)
- **AND** the token SHALL be stored in the spawn-register-watchdog entry armed for this spawn

#### Scenario: Token minted on resume/fork
- **WHEN** `handleResumeSession` invokes `spawnPiSession(cwd, { sessionFile, mode })`
- **THEN** a unique `spawnToken` SHALL be generated for the new pi process
- **AND** for `mode: "fork"`, the token SHALL be used as the key in `pendingForkRegistry.recordFork(token, parentSessionId)`

#### Scenario: Token minted on auto-resume-on-prompt
- **WHEN** `handleSendPrompt` detects `status: "ended"` and triggers an auto-resume spawn
- **THEN** a unique `spawnToken` SHALL be generated and used to populate registries
- **AND** the absence of a client-issued `requestId` SHALL NOT prevent token minting

#### Scenario: Token minted on headless reload
- **WHEN** `handleHeadlessReload` kills and respawns a headless session
- **THEN** a unique `spawnToken` SHALL be generated for the respawned process and attached to the new `headlessPidRegistry` entry

### Requirement: `PI_DASHBOARD_SPAWN_TOKEN` env-var injection
The `spawnPiSession` function SHALL inject the minted `spawnToken` into the spawned process's environment as `PI_DASHBOARD_SPAWN_TOKEN`. The injection SHALL happen via the existing `buildSpawnEnv` flow so it applies to every spawn mechanism. The token SHALL NOT be passed via argv or via the session JSONL file.

#### Scenario: Token present in spawned process env
- **WHEN** `spawnPiSession(cwd, opts)` runs and produces a spawned process
- **THEN** `process.env.PI_DASHBOARD_SPAWN_TOKEN` in the spawned process SHALL equal the `spawnToken` minted for that invocation

#### Scenario: Existing env vars preserved
- **WHEN** the dashboard server has its own environment containing `PI_DASHBOARD_URL`, `PATH`, etc.
- **THEN** the spawned process SHALL receive those vars unchanged in addition to `PI_DASHBOARD_SPAWN_TOKEN`

#### Scenario: Token is not echoed to argv
- **WHEN** the server inspects the spawned process command line
- **THEN** the `spawnToken` SHALL NOT appear as a CLI argument

### Requirement: Bridge reads `PI_DASHBOARD_SPAWN_TOKEN` and includes it on first register only
The bridge extension SHALL read `process.env.PI_DASHBOARD_SPAWN_TOKEN` at registration time. The bridge SHALL include `spawnToken` in `session_register` IFF `bc.hasRegisteredOnce === false` (the very first register for this bridge process). For all subsequent registers — including reattach (after dashboard restart), `handleSessionChange` (in-process new/fork/resume), and any other path — the `spawnToken` field SHALL be omitted.

#### Scenario: First register includes the token
- **WHEN** a bridge process boots and `sendStateSync` runs for the first time
- **AND** `process.env.PI_DASHBOARD_SPAWN_TOKEN` is set to a non-empty string
- **THEN** the emitted `session_register` SHALL include `spawnToken` equal to the env-var value
- **AND** `bc.hasRegisteredOnce` SHALL be `true` after the call

#### Scenario: Reattach register omits the token
- **WHEN** the bridge reconnects after dashboard restart and `sendStateSync` runs again
- **THEN** the emitted `session_register` SHALL have `registerReason: "reattach"` and SHALL NOT include `spawnToken`

#### Scenario: In-process session change omits the token
- **WHEN** the user triggers Ctrl+F (fork), `/resume`, or `/new` inside the bridge's pi process and `handleSessionChange` runs
- **THEN** the emitted `session_register` for the new sessionId SHALL NOT include `spawnToken`

#### Scenario: Missing env-var produces no token field
- **WHEN** the bridge boots inside a pi process whose env does not contain `PI_DASHBOARD_SPAWN_TOKEN` (e.g. user-launched pi outside the dashboard)
- **THEN** the emitted `session_register` SHALL NOT include a `spawnToken` field
- **AND** the protocol message SHALL still validate

### Requirement: Three-tier link in `headlessPidRegistry`
The `headlessPidRegistry` SHALL expose three link methods used by `event-wiring.ts` upon receipt of `session_register`. The methods SHALL be tried in priority order: `linkByToken` → `linkByPid` → `linkSession` (existing cwd-FIFO). The first method that finds a match SHALL set `entry.sessionId` and return; subsequent tiers SHALL NOT be tried for the same register.

The registry's `register(pid, cwd, proc, token?)` signature SHALL accept an optional `spawnToken` and SHALL store it on the entry alongside `pid`, `cwd`, `sessionId?`, and `spawnedAt`.

#### Scenario: Token match wins over pid and cwd
- **WHEN** `event-wiring` receives `session_register { sessionId: "S", cwd: "/p", pid: 1234, spawnToken: "tok_abc" }`
- **AND** `headlessPidRegistry` contains an entry `{ pid: 1234, cwd: "/p", sessionId: undefined, spawnToken: "tok_abc" }`
- **THEN** `linkByToken("tok_abc", "S", 1234)` SHALL set that entry's `sessionId = "S"` and return
- **AND** `linkByPid` and `linkSession` SHALL NOT be invoked for this register

#### Scenario: Pid match used when token is absent
- **WHEN** `event-wiring` receives `session_register { sessionId: "S", cwd: "/p", pid: 1234 }` with no `spawnToken` (legacy bridge)
- **AND** `headlessPidRegistry` contains an entry with `pid: 1234, sessionId: undefined`
- **THEN** `linkByPid("S", 1234)` SHALL set that entry's `sessionId = "S"` and return
- **AND** `linkSession` SHALL NOT be invoked for this register

#### Scenario: Cwd-FIFO fallback used when token and pid both absent
- **WHEN** `event-wiring` receives `session_register { sessionId: "S", cwd: "/p" }` with no `spawnToken` and no `pid` (e.g. tmux strategy with legacy server)
- **THEN** the existing cwd-FIFO `linkSession("S", "/p")` SHALL be invoked
- **AND** the first unsessioned entry in cwd `/p` SHALL be tagged

#### Scenario: Stale token degrades to lower tier
- **WHEN** a bridge sends `session_register` with a `spawnToken` that the server does not have any entry for (e.g. server was restarted mid-spawn)
- **THEN** `linkByToken` SHALL return `false` without modifying any entry
- **AND** the next tier (`linkByPid` or `linkSession`) SHALL be tried

#### Scenario: Already-linked entry is skipped at every tier
- **WHEN** any link tier inspects an entry whose `sessionId` is already set
- **THEN** that entry SHALL NOT be relinked at any tier

### Requirement: Client mints `requestId` on every browser-initiated spawn or resume
The client SHALL generate a UUIDv4 (`crypto.randomUUID()`) `requestId` whenever it dispatches a `spawn_session` or `resume_session` message. The `requestId` SHALL be sent as part of the message and tracked in a client-side `pendingSpawns: Map<requestId, { cwd, startedAt, attachProposal? }>` map (replacing today's `spawningCwds: Set<cwd>`).

#### Scenario: Spawn dispatch generates and tracks requestId
- **WHEN** the user clicks "New session" in a folder group
- **THEN** the client SHALL generate a fresh `requestId`
- **AND** the client SHALL add `(requestId, { cwd, startedAt: now() })` to `pendingSpawns`
- **AND** the dispatched `spawn_session` message SHALL contain the `requestId`

#### Scenario: Resume dispatch generates and tracks requestId
- **WHEN** the user clicks Resume or Fork on a session card
- **THEN** the client SHALL generate a fresh `requestId`
- **AND** the dispatched `resume_session` message SHALL contain the `requestId`

#### Scenario: Concurrent spawns produce distinct requestIds
- **WHEN** the user (or programmatic flow) issues two `spawn_session` calls in the same cwd within milliseconds
- **THEN** each call SHALL generate a distinct `requestId`
- **AND** `pendingSpawns` SHALL contain two entries simultaneously

### Requirement: Server echoes `requestId` and broadcasts `spawnRequestId`
When the server receives a `spawn_session` or `resume_session` carrying `requestId`, it SHALL:

1. Echo the `requestId` field in the corresponding `spawn_result` or `resume_result` message.
2. Associate the `requestId` with the minted `spawnToken` in an internal map (`pendingClientCorrelations: Map<spawnToken, requestId>`) so a later `session_register` carrying the token can be broadcast as `session_added` with the matching `spawnRequestId`.

The `session_added` browser message SHALL include `spawnRequestId?: string` populated from this map when known.

#### Scenario: spawn_result echoes requestId
- **WHEN** the server processes `spawn_session { cwd, requestId: "rq_42" }` and emits `spawn_result`
- **THEN** the emitted `spawn_result` SHALL include `requestId: "rq_42"`

#### Scenario: resume_result echoes requestId
- **WHEN** the server processes `resume_session { sessionId, mode, requestId: "rq_99" }` and emits `resume_result`
- **THEN** the emitted `resume_result` SHALL include `requestId: "rq_99"`

#### Scenario: session_added carries spawnRequestId
- **WHEN** a bridge later registers with `spawnToken` matching the token minted for `requestId: "rq_42"`
- **AND** the new session is broadcast via `session_added`
- **THEN** the broadcast SHALL include `spawnRequestId: "rq_42"`

#### Scenario: server-initiated spawn omits spawnRequestId
- **WHEN** auto-resume-on-prompt or any other server-only flow spawns a session (no client requestId exists)
- **THEN** the resulting `session_added` broadcast SHALL omit `spawnRequestId`

### Requirement: Client auto-selects newly registered session by requestId match
The client `useMessageHandler.ts` SHALL, on receipt of `session_added`, look up `msg.spawnRequestId` in its `pendingSpawns` map. If found, the client SHALL: (a) remove the entry from `pendingSpawns`, (b) navigate to `/session/<msg.session.id>`, (c) cancel the spawn-timeout timer for that requestId. If `spawnRequestId` is absent or unknown, the client SHALL NOT auto-navigate (existing behavior preserved for natural session arrivals).

#### Scenario: Auto-select after spawn
- **WHEN** the user spawned a session with `requestId: "rq_42"`
- **AND** `session_added { session, spawnRequestId: "rq_42" }` arrives
- **THEN** the client SHALL navigate to that session's URL
- **AND** the matching placeholder card SHALL be removed

#### Scenario: Auto-select after fork
- **WHEN** the user forked a session with `requestId: "rq_77"`
- **AND** `session_added { session, spawnRequestId: "rq_77" }` arrives for the forked session
- **THEN** the client SHALL navigate to the new (forked) session's URL
- **AND** the parent session's resuming flag SHALL be cleared

#### Scenario: No auto-select for natural sessions
- **WHEN** `session_added { session }` arrives without `spawnRequestId` (e.g. a TUI-spawned session)
- **THEN** the client SHALL NOT change the active route

#### Scenario: Unknown spawnRequestId tolerated
- **WHEN** `session_added { session, spawnRequestId: "rq_unknown" }` arrives but `pendingSpawns` has no matching entry (e.g. timeout already cleared)
- **THEN** the client SHALL NOT throw and SHALL NOT navigate

### Requirement: Token TTL aligned with `spawn-register-watchdog`
The effective TTL of a `spawnToken` SHALL equal the spawn-register-watchdog timeout (default 30s, configurable via `config.spawnRegisterTimeoutMs` in the range 5000–120000). When the watchdog timer fires for a spawn, the corresponding registry entries (headlessPidRegistry, pendingForkRegistry, pendingAttachRegistry, pendingClientCorrelations) keyed by that spawnToken SHALL be cleared as part of timeout cleanup. No separate token-TTL machinery SHALL be introduced.

#### Scenario: Token cleared on watchdog timeout
- **WHEN** a spawn's watchdog fires after 30s with no `session_register` arriving
- **THEN** the `pendingClientCorrelations` entry for that spawnToken SHALL be deleted
- **AND** any unsessioned `headlessPidRegistry` entry holding that token SHALL be cleaned up by existing process-exit hooks

#### Scenario: Token persists across late-recovery window
- **WHEN** a bridge registers with a `spawnToken` after the watchdog already fired but within the 60s `recentlyFired` recovery window
- **THEN** the watchdog SHALL emit `spawn_register_recovered`
- **AND** the `pendingClientCorrelations` entry MAY still be queryable for the recovery emission (best-effort; recovery does not require token identity to be intact)

### Requirement: No persistence of tokens or correlation state
Tokens, requestIds, and the `pendingClientCorrelations` map SHALL be in-memory only. Server restart SHALL drop all in-flight correlation state. Bridges holding a stale token in their env after a server restart SHALL fall through to lower-tier matching (pid → cwd-FIFO).

#### Scenario: Server restart drops correlations
- **WHEN** the server restarts mid-spawn (after `spawnPiSession` returned but before bridge registered)
- **THEN** the in-memory token map SHALL be empty after restart
- **AND** when the bridge eventually registers with the now-stale token, `linkByToken` SHALL fail and `linkByPid` SHALL be tried next

#### Scenario: No token written to disk
- **WHEN** any registry persists state to disk (e.g. `~/.pi/dashboard/headless-pids.json`)
- **THEN** the persisted shape SHALL NOT contain a `spawnToken` field
