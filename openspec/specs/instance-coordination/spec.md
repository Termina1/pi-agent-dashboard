## Purpose

Ensure at most one dashboard instance runs per canonical HOME directory. The dashboard owns HOME-scoped state (`~/.pi/agent/settings.json`, dashboard-owned per-session `.meta.json` cache files under `~/.pi/dashboard/session-meta/`, `~/.pi/dashboard/preferences.json`, `headless-pids.json`, `editor-pids.json`) that would corrupt under concurrent writers. A per-HOME advisory lock enforces this invariant at runtime; multi-user (two distinct canonical HOMEs on the same host) continues to work because each user has a distinct lock path.

Implementation: `packages/server/src/home-lock.ts` (acquisition + metadata sidecar), `packages/server/src/home-lock-release.ts` (signal handlers), `packages/electron/src/lib/lock-metadata.ts` (Electron-side reader), `packages/extension/src/server-auto-start.ts::readLockMetaPort` (bridge fallback). Historical context: see `openspec/changes/archive/*-single-dashboard-per-home/`.

## Requirements

### Requirement: Per-HOME advisory lock
The dashboard server SHALL acquire a per-HOME advisory lock at `<canonicalHomedir>/.pi/dashboard/server.lock` via `proper-lockfile` before listening on its configured ports. Only one dashboard instance per HOME MAY hold the lock at a time.

#### Scenario: Fresh acquire
- **WHEN** no prior dashboard has run for this HOME
- **AND** `pi-dashboard` starts
- **THEN** the lock is acquired successfully
- **AND** a metadata sidecar `server.lock.meta.json` is written with `{ pid, ppid, httpPort, piPort, startedAt, identity, version, url, hostname }`

#### Scenario: Lock held by alive instance
- **WHEN** another dashboard instance is running and holds the lock
- **AND** a new `pi-dashboard` starts
- **THEN** the new instance reads the metadata sidecar
- **AND** verifies via `isProcessAlive(pid) && isDashboardRunning(httpPort)` with matching identity (returned by `/api/health`)
- **AND** attaches by invoking `openBrowser(meta.url)` and exiting with code 0

#### Scenario: Stale lock (process dead)
- **WHEN** the lock file exists but the recorded PID is dead
- **THEN** `proper-lockfile`'s stale detection (configured `staleDuration: 10s`) reports the lock as stale
- **AND** the new instance steals the lock
- **AND** removes the stale metadata sidecar

#### Scenario: Identity mismatch
- **WHEN** the lock is held and the PID is alive
- **AND** `isDashboardRunning(httpPort)` succeeds but `/api/health` returns a different identity than the metadata sidecar
- **THEN** the new instance exits with code 1 and an error message: `"Port <n> is in use by an unrelated process (PID <n>). Configure a different port or stop that process."`

### Requirement: HOME canonicalization
All lock-related HOME-scoped paths SHALL be derived from a canonical homedir that is immune to `$HOME` env-var mutation. The implementation SHALL prefer `os.userInfo().homedir` (which consults `getpwuid(3)` on POSIX and `USERPROFILE` on Windows) over `os.homedir()` (which honors `$HOME` on POSIX). The result SHALL then be passed through `fs.realpathSync` to collapse symlinks. `os.homedir()` is retained only as a fallback when `os.userInfo()` throws.

`$HOME` override would allow GUI-launched and shell-launched processes to disagree on HOME identity; explicitly ignoring it prevents this class of race.

#### Scenario: Symlinked homedir canonicalizes
- **WHEN** the user's homedir is a symlink (e.g. `/Users/robson → /System/Volumes/Data/Users/robson` on macOS after FileVault migration)
- **THEN** the lock path uses the realpath target consistently across all invocations

#### Scenario: $HOME override ignored on POSIX
- **WHEN** a launcher exports `$HOME=/tmp/garbage` before starting `pi-dashboard`
- **THEN** `canonicalHomedir()` returns the user's real home (via `getpwuid`), NOT `/tmp/garbage`
- **AND** the lock path is stable across GUI-launched vs shell-launched processes

#### Scenario: Git Bash vs PowerShell on Windows
- **WHEN** `$HOME=/c/Users/R` (Git Bash) but `USERPROFILE=C:\Users\R` (PowerShell)
- **THEN** `canonicalHomedir()` uses `USERPROFILE` (via `os.userInfo().homedir`) for both shells and returns the same canonical path

### Requirement: Graceful release
On graceful shutdown (SIGINT, SIGTERM, SIGHUP, SIGBREAK, explicit `/api/shutdown`, explicit `/api/restart`), the dashboard SHALL release the lock and delete the metadata sidecar before exiting. The release MUST be idempotent so repeated signals do not double-release.

#### Scenario: SIGTERM triggers release
- **WHEN** the dashboard receives SIGTERM
- **THEN** the signal handler calls `release()` and removes `server.lock.meta.json`
- **AND** the process exits with code 0

#### Scenario: /api/shutdown triggers release
- **WHEN** a `POST /api/shutdown` is received
- **THEN** the route handler calls the injected `releaseLock()` callback before invoking `process.exit(0)`

#### Scenario: /api/restart hands off the lock
- **WHEN** a `POST /api/restart` is received
- **THEN** the route handler calls `releaseLock()` before spawning the orchestrator so the replacement process doesn't wait through stale detection

#### Scenario: Windows Ctrl+Break (SIGBREAK)
- **WHEN** the dashboard receives SIGBREAK on Windows
- **THEN** the release handler fires exactly once and the metadata sidecar is removed

#### Scenario: Hard kill leaves lock for stale detection
- **WHEN** the dashboard is killed with SIGKILL or `taskkill /F`
- **THEN** the lock file remains (no signal handler runs)
- **AND** the next startup's `proper-lockfile.lock()` detects it as stale via the heartbeat timeout (10s default)

### Requirement: Multi-user support
Two real users on the same host SHALL be able to run their own dashboards independently. Each user's canonical HOME produces a separate lock path, so neither lock acquisition attempt affects the other.

#### Scenario: Two users, two dashboards
- **WHEN** user A (canonical home `/home/alice`) and user B (canonical home `/home/bob`) each run `pi-dashboard`
- **THEN** each acquires their own lock at their own `<home>/.pi/dashboard/server.lock`
- **AND** neither interferes with the other

#### Scenario: Port collision surfaced with actionable error
- **WHEN** user A's dashboard listens on 8000
- **AND** user B's `pi-dashboard` starts with the same `config.port`
- **THEN** the per-HOME lock path differs (each user has a distinct canonical HOME), so both pass the lock-acquisition gate independently
- **AND** the process that loses the port race exits with `"Port 8000 is occupied by another service"` (existing `cli.ts` behavior); the user reconfigures the port in `~/.pi/dashboard/config.json` or via `--port`
- **AND** the port-choice mechanism is orthogonal to the HOME lock (port auto-increment is deliberately out of scope)

### Requirement: Restart handoff
The `/api/restart` orchestrator SHALL wait for the old server's lock to become available before spawning the replacement process. The wait SHALL be bounded (100 × 100ms = 10s budget); if the old server fails to release within that window, the replacement's own `proper-lockfile` call will steal the stale lock on the next pass.

#### Scenario: Clean restart
- **WHEN** `POST /api/restart` fires
- **AND** the old server exits gracefully (releases lock)
- **THEN** the orchestrator polls `<lock>.lock/` directory presence until it disappears (≤10s)
- **AND** spawns the new server which acquires the lock as normal

#### Scenario: Restart with hung old server
- **WHEN** the old server fails to exit within the restart grace period
- **THEN** the orchestrator proceeds to spawn the replacement after the 10s poll budget elapses
- **AND** the replacement steals the stale lock via proper-lockfile's stale-detection pass

### Requirement: Escape hatch
Setting environment variable `PI_DASHBOARD_ALLOW_MULTIPLE=1` (or `=true`) SHALL skip lock acquisition entirely. This is unsupported behavior for power users and testing; it is documented but not advertised.

#### Scenario: Env var disables lock
- **WHEN** `PI_DASHBOARD_ALLOW_MULTIPLE=1` is set
- **AND** `pi-dashboard` starts
- **THEN** no lock acquisition is attempted
- **AND** no metadata sidecar is written
- **AND** the startup log contains a warning: `"[WARN] PI_DASHBOARD_ALLOW_MULTIPLE set — HOME-scoped races may cause corruption"`

#### Scenario: Other values do not disable the lock
- **WHEN** `PI_DASHBOARD_ALLOW_MULTIPLE=0`, `=""`, `=yes`, or unset
- **THEN** lock acquisition proceeds normally

### Requirement: Metadata sidecar robustness
The metadata sidecar (`server.lock.meta.json`) SHALL be written atomically (tmp + rename) and tolerated when corrupt, missing, or unreadable (treated as "assume stale" so the lock can be stolen).

#### Scenario: Atomic write survives crash mid-write
- **WHEN** the server crashes during metadata write
- **THEN** the on-disk metadata file is either the old valid version or the new valid version — never a partial write

#### Scenario: Corrupt metadata treated as stale
- **WHEN** the metadata file contains malformed JSON or schema-mismatched content
- **THEN** `readMetadata()` returns `null`
- **AND** the lock holder is treated as stale
- **AND** the lock is stolen on the retry pass

#### Scenario: Concurrent-launch race avoided via metadata-land poll
- **WHEN** two callers race on `acquireOrAttach`
- **AND** the winner has acquired the lock but has not yet written metadata
- **THEN** the loser polls the metadata file for up to 500ms (20 × 25ms) before concluding "no metadata = stale"
- **AND** once the winner writes metadata, the loser returns `mode: "attach"` with the winner's identity

### Requirement: Server PID file remains advisory
The legacy `server-pid.ts` PID file (`~/.pi/dashboard/server.pid`) SHALL continue to be written on startup for back-compat with external tooling, but the lock file is the authoritative source of instance identity.

#### Scenario: PID file still written
- **WHEN** the dashboard starts
- **THEN** both `server.pid` (via `writePid`) and `server.lock.meta.json` (via `acquireOrAttach`) are written

#### Scenario: Conflict resolution
- **WHEN** the PID file and lock metadata disagree (e.g., old PID file lingers from a stale crash)
- **THEN** the lock metadata wins — the PID file is silently overwritten on lock acquisition
