## ADDED Requirements

### Requirement: OpenSpec data carries a pending flag for cold-boot signaling

The `OpenSpecData` payload SHALL carry an optional `pending: boolean`
field that disambiguates "no `openspec/changes/` directory" from
"directory exists but slow poll has not yet completed". The field is
optional for backwards compatibility; absence means
`pending === false`.

#### Scenario: Pending true when openspec dir exists but cache empty

- **WHEN** a browser connects and the server has a known cwd whose
  `openspec/changes/` directory exists but `getOpenSpecData(cwd)`
  returns `undefined` or `{ initialized: false }`
- **THEN** the server SHALL emit
  `openspec_update { cwd, data: { initialized: false, pending: true, changes: [] } }`

#### Scenario: Pending false when no openspec dir

- **WHEN** a browser connects and the server has a known cwd whose
  `openspec/changes/` directory does not exist
- **THEN** the server SHALL emit
  `openspec_update { cwd, data: { initialized: false, pending: false, changes: [] } }`

#### Scenario: Pending omitted once data initialized

- **WHEN** the slow poll completes successfully and the cache holds
  `{ initialized: true, changes: [...] }`
- **THEN** broadcasts SHALL emit `data: { initialized: true, changes: [...] }`
  with no `pending` field set (or `pending: false`)

### Requirement: Bootstrap broadcasts initial poll completion

After bootstrap kicks off the asynchronous initial OpenSpec poll for
every known cwd, the server SHALL broadcast `openspec_update` for any
cwd whose poll completion produces data that differs from the prior
cache (including a transition from empty/undefined to populated). This
SHALL use the same `priorEmpty || dataDiffers` predicate as
`runPostInstallRepair`.

#### Scenario: Cold boot with browser already connected

- **WHEN** a browser connects to the server before bootstrap's initial
  `refreshOpenSpec(cwd)` has resolved for cwd `/project/foo`
- **AND** the openspec/changes/ directory under `/project/foo` is later
  successfully polled with N>0 changes
- **THEN** the server SHALL broadcast
  `openspec_update { cwd: "/project/foo", data: { initialized: true, changes: [...] } }`
  to the connected browser without requiring a manual reload

#### Scenario: Warm restart without data change

- **WHEN** the bootstrap initial poll resolves and the freshly-polled
  data is identical to the prior cache (e.g. on a hot reload where
  the cache survived)
- **THEN** the server SHALL NOT emit a redundant `openspec_update`
  for that cwd

## MODIFIED Requirements

### Requirement: Server polls openspec CLI per directory
The server SHALL run `openspec list --json` and `openspec status --change <name> --json` for each known directory at a **configurable interval** (default 30 seconds, range 5–3600 seconds, controlled by `DashboardConfig.openspec.pollIntervalSeconds`) and broadcast results keyed by cwd to connected browsers. Each directory's poll SHALL be offset within the interval by a deterministic per-cwd phase (range 0 to `DashboardConfig.openspec.jitterSeconds`, default 5 s) so that polls do not all align on the same tick.

#### Scenario: Periodic poll for a known directory
- **WHEN** one poll interval has elapsed since the last poll for a directory
- **THEN** the server SHALL evaluate the directory for re-polling (subject to change detection, see below) and broadcast an `openspec_update` message with `cwd` and `data` fields if the data has changed

#### Scenario: Configurable interval
- **WHEN** `DashboardConfig.openspec.pollIntervalSeconds` is set to 60
- **THEN** the server SHALL poll every 60 seconds instead of 30
- **AND** changing this value via `PUT /api/config` SHALL take effect without a server restart

#### Scenario: Deterministic per-cwd phase offset
- **WHEN** three known directories exist and `jitterSeconds` is 5
- **THEN** each directory's poll SHALL fire at a stable offset in `[0, 5000) ms` derived from a hash of its cwd
- **AND** the same cwd SHALL receive the same offset on every tick

#### Scenario: Initial poll on server startup
- **WHEN** the server starts with known directories
- **THEN** the server SHALL poll openspec for each known directory and **after each poll completes**, broadcast `openspec_update` to all connected browsers when the prior cache was empty/undefined or the polled data differs from prior

#### Scenario: New directory becomes known
- **WHEN** a new pinned directory is added or a session registers with a new cwd
- **THEN** the server SHALL immediately poll openspec for that directory (bypassing both jitter and change detection for this first poll)

#### Scenario: openspec CLI not available
- **WHEN** `openspec` is not installed or the directory is not an openspec project
- **THEN** the server SHALL cache `{ initialized: false, pending: false, changes: [] }` for that directory

#### Scenario: Browser requests immediate refresh
- **WHEN** a browser sends `openspec_refresh` with a `cwd` field
- **THEN** the server SHALL immediately re-poll the openspec CLI for that directory, **bypassing change detection** but still respecting the concurrency cap, and broadcast the result

### Requirement: OpenSpec data keyed by directory in browser protocol
The server SHALL send `openspec_update` messages to browsers keyed by `cwd` instead of `sessionId`.

#### Scenario: Browser receives openspec_update
- **WHEN** the server broadcasts an openspec_update
- **THEN** the message SHALL contain `{ type: "openspec_update", cwd: string, data: OpenSpecData }` with no sessionId field

#### Scenario: Browser connects and receives initial state
- **WHEN** a browser WebSocket connects
- **THEN** the server SHALL emit exactly one `openspec_update` per cwd in `knownDirectories()`:
  - `{ initialized: true, changes: [...] }` when the cache holds populated data
  - `{ initialized: false, pending: true, changes: [] }` when `<cwd>/openspec/changes/` exists (synchronous fs detection) but slow-poll data has not yet been cached
  - `{ initialized: false, pending: false, changes: [] }` when `<cwd>/openspec/changes/` does not exist
- **AND** the server SHALL NOT silently omit any known cwd from the initial snapshot
