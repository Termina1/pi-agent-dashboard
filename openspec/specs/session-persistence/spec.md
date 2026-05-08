## ADDED Requirements

### Requirement: Visible sessions persist across restarts
The system SHALL persist session metadata in dashboard-owned per-session `.meta.json` files under `~/.pi/dashboard/session-meta/`, keyed by each session's `.jsonl` path. On startup, the system SHALL discover sessions by scanning `~/.pi/agent/sessions/*/` for `.jsonl` files and restoring cached data from the dashboard-owned `.meta.json` store.

#### Scenario: Server restarts with ended sessions
- **WHEN** the server has ended sessions with `.meta.json` files and the server restarts
- **THEN** those sessions SHALL be discovered by filesystem scan and appear in the session list with `dataUnavailable: true`

#### Scenario: Server restarts with no session files
- **WHEN** the server starts and no cached `.meta.json` files exist under `~/.pi/dashboard/session-meta/`
- **THEN** the server SHALL start with an empty session list (no errors)

#### Scenario: Active session bridge reconnects after restart
- **WHEN** a session is restored from `.meta.json` on startup and the bridge later reconnects with the same session ID
- **THEN** the bridge registration SHALL overwrite the stale cached entry with live data and clear `dataUnavailable`

### Requirement: Hidden sessions persist in their own meta file
The system SHALL persist hidden sessions in their `.meta.json` with `hidden: true`. Hidden sessions SHALL be restored on startup and remain hidden. There SHALL be no centralized hidden sessions list.

#### Scenario: Session is hidden
- **WHEN** a user hides a session
- **THEN** that session's `.meta.json` SHALL be updated with `hidden: true`

#### Scenario: Hidden session restored on startup
- **WHEN** the server restarts and a `.meta.json` has `hidden: true`
- **THEN** the session SHALL be restored as hidden

### Requirement: Debounced persistence writes
The system SHALL debounce writes to `.meta.json` independently per session to avoid excessive disk I/O. Pending writes SHALL be flushed on server shutdown.

#### Scenario: Rapid session updates
- **WHEN** multiple updates to a single session occur within the debounce window (1 second)
- **THEN** only one write to that session's `.meta.json` SHALL occur

#### Scenario: Server shutdown with pending changes
- **WHEN** the server shuts down with unsaved session changes
- **THEN** the system SHALL flush all pending `.meta.json` writes before exit

### Requirement: Atomic file writes
The system SHALL use atomic write operations (write-to-temp + rename) to prevent corruption if the server crashes during a write.

#### Scenario: Server crashes during write
- **WHEN** the server crashes while writing a `.meta.json` file
- **THEN** the previous valid version of the file SHALL remain intact
