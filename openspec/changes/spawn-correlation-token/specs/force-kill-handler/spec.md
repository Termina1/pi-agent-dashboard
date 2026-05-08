## MODIFIED Requirements

### Requirement: Force kill process escalation
When the server receives a `force_kill` message, it SHALL terminate the session's process using the platform-provided `killProcess(pid, { timeoutMs: 2000 })` helper so that the entire process subtree is terminated on every supported OS. On Windows this delegates to `taskkill /F /T /PID <pid>` (immediate tree kill). On POSIX this sends `SIGTERM`, waits up to 2 seconds, and sends `SIGKILL` if the process is still alive. The server SHALL NOT call `process.kill(pid, …)` directly.

The PID used for kill resolution SHALL come from the session's stored `pid` field (`DashboardSession.pid`), populated from `session_register.pid`. The PID stored on the session SHALL have been correlated to the session via the three-tier link in `headlessPidRegistry` (`linkByToken` → `linkByPid` → `linkSession`), so that for sessions registered with a `spawnToken`, the kill target is unambiguously the pi process matching that token rather than the first unsessioned entry in the cwd. This eliminates the prior race where a sibling spawn in the same cwd could be killed by mistake.

`headlessPidRegistry.killBySessionId(sessionId)` SHALL look up the entry by `sessionId` set during link, and SHALL kill the `pid` recorded on that entry. When called for a session whose registry entry was linked via `linkByToken` or `linkByPid`, the kill SHALL target the strongly-correlated PID. When linked only via cwd-FIFO (legacy), behavior SHALL match pre-change semantics.

#### Scenario: Windows tree kill via taskkill
- **WHEN** the server handles a `force_kill` on `process.platform === "win32"` for a session with a known PID
- **THEN** it SHALL invoke `killProcess(pid, { timeoutMs: 2000 })` from `@blackbelt-technology/pi-dashboard-shared/platform/process.js`
- **AND** the platform helper SHALL execute `taskkill /F /T /PID <pid>` so that descendant processes are also terminated

#### Scenario: POSIX SIGTERM sent first
- **WHEN** the server handles a `force_kill` on `process.platform === "linux"` or `"darwin"` for a session with a known PID
- **THEN** `killProcess` SHALL send `SIGTERM` to the PID first

#### Scenario: POSIX SIGKILL after timeout
- **WHEN** `killProcess` has sent `SIGTERM` AND the process is still alive after 2 seconds
- **THEN** `killProcess` SHALL send `SIGKILL` to the PID
- **AND** return `{ ok: true, forced: true }`

#### Scenario: Process already dead after SIGTERM
- **WHEN** `killProcess` has sent `SIGTERM` AND the process exits within 2 seconds
- **THEN** `killProcess` SHALL NOT send `SIGKILL`
- **AND** return `{ ok: true, forced: false }`

#### Scenario: No PID available
- **WHEN** a `force_kill` is received for a session with no stored PID
- **THEN** the server SHALL force-close the bridge WebSocket connection
- **AND** return `force_kill_result` with `success: true` and a message indicating WS-only kill

#### Scenario: No direct process.kill in the handler
- **WHEN** the repo-level enforcement test scans `packages/server/src/browser-handlers/session-action-handler.ts`
- **THEN** no `process.kill(` call SHALL be present
- **AND** all termination SHALL go through `killProcess` or `killPidWithGroup`

#### Scenario: Forked session kill does not target parent (token-linked sibling)
- **GIVEN** a parent session P linked to PID 1000 in the same cwd as fork session F linked to PID 1234, both linked via `linkByToken` using their respective spawn tokens
- **WHEN** the user issues `force_kill` for session F
- **THEN** the killed PID SHALL be 1234 (F's PID, by token-correlated linkage)
- **AND** PID 1000 SHALL NOT be signalled
- **AND** session P SHALL remain active

#### Scenario: Forked session kill does not target parent (pid-linked sibling)
- **GIVEN** a parent session P linked to PID 1000 in the same cwd as fork session F linked to PID 1234, both linked via `linkByPid` (legacy bridge sending pid but not token)
- **WHEN** the user issues `force_kill` for session F
- **THEN** the killed PID SHALL be 1234
- **AND** PID 1000 SHALL NOT be signalled
