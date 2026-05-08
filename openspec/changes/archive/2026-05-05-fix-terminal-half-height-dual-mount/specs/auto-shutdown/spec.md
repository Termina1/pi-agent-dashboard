## MODIFIED Requirements

### Requirement: Idle shutdown when no pi sessions connected
The server SHALL automatically shut down after a configurable idle period when no pi extension WebSocket connections exist AND no terminal PTY sessions are alive. Before exiting, the idle timer callback SHALL verify that (1) no pi connections currently exist, (2) no terminal PTYs are alive (`terminalManager.list().length === 0`), and (3) real wall-clock time since the last connection is at least `shutdownIdleSeconds`. If any check fails, the timer SHALL restart instead of exiting.

A user-spawned terminal running a long process (e.g. `cargo build`, `npm install`, `tail -f`) without an attached pi session SHALL keep the server alive — the terminal counts as user activity for idle-shutdown purposes.

#### Scenario: Last pi session disconnects cleanly
- **WHEN** the last pi extension sends `session_unregister` and no connections remain
- **THEN** the server SHALL start an idle countdown of `shutdownIdleSeconds` seconds

#### Scenario: Last pi session disconnects dirty (crash/network)
- **WHEN** the last pi extension WebSocket closes without `session_unregister`
- **THEN** the server SHALL start the idle countdown after the heartbeat timeout clears the connection

#### Scenario: Idle countdown expires with no pi sessions and no terminals
- **WHEN** the idle countdown reaches zero with no new pi connections and `terminalManager.list().length === 0`
- **THEN** the server SHALL verify no connections exist, no terminal PTYs are alive, and real elapsed idle time >= `shutdownIdleSeconds` before shutting down

#### Scenario: New pi session connects during countdown
- **WHEN** a new pi extension connects while the idle countdown is running
- **THEN** the server SHALL cancel the idle countdown

#### Scenario: Server starts with no sessions
- **WHEN** the server starts and no pi sessions connect
- **THEN** the server SHALL start the idle countdown immediately

#### Scenario: Browser connections do not prevent shutdown
- **WHEN** browser clients are connected but no pi sessions exist and no terminal PTYs are alive
- **THEN** the server SHALL still shut down after the idle period

#### Scenario: Active terminal prevents shutdown
- **WHEN** the idle countdown fires and one or more terminal PTYs are alive
- **THEN** the server SHALL NOT shut down
- **THEN** the idle timer SHALL restart and re-check on the next tick

#### Scenario: Terminal exits during countdown
- **WHEN** the last terminal PTY exits while the idle countdown is running and no pi sessions are connected
- **THEN** the idle countdown SHALL continue and SHALL be allowed to expire normally

#### Scenario: Sleep/wake false idle prevention
- **WHEN** the idle countdown fires after laptop wake and a pi session has reconnected since the timer was started
- **THEN** the server SHALL restart the idle countdown instead of exiting
