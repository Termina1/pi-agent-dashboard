## ADDED Requirements

### Requirement: Dashboard-owned per-session meta store persists dashboard state
The system SHALL store all dashboard-owned per-session state in a dashboard-owned `.meta.json` file under `~/.pi/dashboard/session-meta/`, keyed by the session's `.jsonl` path. The on-disk filename MAY be hashed or otherwise derived from the `.jsonl` path, but it SHALL be stable for a given session file path.

#### Scenario: Dashboard-owned fields persisted
- **WHEN** a session has dashboard-set properties (name, attachedProposal, hidden, source)
- **THEN** those properties SHALL be written to the session's `.meta.json` file

#### Scenario: Cached stats persisted
- **WHEN** a session accumulates stats (tokens, cost, model, status, timestamps, context usage)
- **THEN** those stats SHALL be cached in the session's `.meta.json` file

#### Scenario: Meta file lives under the dashboard-owned cache root
- **WHEN** a session file exists at `~/.pi/agent/sessions/<cwd>/<ts>_<uuid>.jsonl`
- **THEN** the meta file SHALL live under `~/.pi/dashboard/session-meta/`
- **AND** the mapping from session file path to meta file path SHALL be deterministic

### Requirement: All meta fields are optional
The system SHALL treat all fields in `.meta.json` as optional. A minimal file with only `{ "source": "dashboard" }` SHALL be valid and backward-compatible with existing sidecar files.

#### Scenario: Minimal meta file
- **WHEN** a `.meta.json` contains only `{ "source": "dashboard" }`
- **THEN** the system SHALL read it without error and use defaults for missing fields

#### Scenario: Empty or missing meta file
- **WHEN** a `.jsonl` file has no corresponding `.meta.json`
- **THEN** the system SHALL treat the session as having no dashboard-owned state

### Requirement: Independent debounced writes per session
The system SHALL debounce `.meta.json` writes independently per session. A change to session A SHALL NOT trigger a write for session B. Pending writes SHALL be flushed on server shutdown.

#### Scenario: Single session update
- **WHEN** session A receives a token update
- **THEN** only session A's `.meta.json` SHALL be written (after debounce)

#### Scenario: Multiple sessions update concurrently
- **WHEN** sessions A and B both receive updates within the debounce window
- **THEN** each session's `.meta.json` SHALL be written independently

#### Scenario: Server shutdown flushes pending writes
- **WHEN** the server shuts down with pending `.meta.json` writes
- **THEN** all pending writes SHALL be flushed before exit

### Requirement: Atomic meta file writes
The system SHALL use atomic write operations (write-to-temp + rename) for `.meta.json` files to prevent corruption on crash.

#### Scenario: Crash during write
- **WHEN** the server crashes while writing a `.meta.json` file
- **THEN** the previous valid version SHALL remain intact

### Requirement: Session discovery by filesystem scan
The system SHALL discover sessions at startup by scanning all subdirectories under `~/.pi/agent/sessions/` for `.jsonl` files. For each `.jsonl`, the system SHALL look up its dashboard-owned `.meta.json` cache entry and restore the session from cached data when present.

#### Scenario: Startup with cached meta files
- **WHEN** the server starts and dashboard-owned `.meta.json` files exist with cached stats
- **THEN** sessions SHALL be restored from `.meta.json` without parsing `.jsonl` files

#### Scenario: Session file without meta file
- **WHEN** a `.jsonl` file exists without a corresponding `.meta.json`
- **THEN** the system SHALL read the `.jsonl` header for session identity (id, cwd) and optionally extract stats, then write a `.meta.json` for future startups

#### Scenario: Orphaned meta file without session file
- **WHEN** a dashboard-owned `.meta.json` file exists for a session path whose `.jsonl` file no longer exists
- **THEN** the system SHALL ignore the orphaned `.meta.json`

#### Scenario: All directories scanned regardless of pin status
- **WHEN** the server starts
- **THEN** the system SHALL scan all directories under `~/.pi/agent/sessions/`, not just pinned directories

#### Scenario: Bridge reconnects after restart
- **WHEN** a session is restored from `.meta.json` and the bridge later reconnects with the same session ID
- **THEN** the bridge registration SHALL overwrite the stale cached entry with live data

### Requirement: Real cwd from meta cache
The system SHALL cache the real `cwd` in `.meta.json` (sourced from the `.jsonl` header) because the directory encoding is lossy (dashes are ambiguous).

#### Scenario: Cwd resolved from meta
- **WHEN** a `.meta.json` contains a `cwd` field
- **THEN** the system SHALL use that cwd value instead of attempting to decode the directory name

#### Scenario: Cwd fallback to jsonl header
- **WHEN** a `.meta.json` does not contain a `cwd` field
- **THEN** the system SHALL read the `.jsonl` header to determine the real cwd



### Requirement: Persisted contextWindow is authoritative on stale-cache re-extract
The system SHALL preserve the previously persisted `contextWindow` in `.meta.json` whenever stale-cache re-extraction would otherwise overwrite it with a value derived from `.jsonl` parsing or model-id inference. The persisted value MAY only be replaced when the active model changes (the previously persisted value no longer applies) or when no value was previously persisted.

Rationale: pi's persisted `.jsonl` contains no `turn_end` or `contextUsage` entries, so any value `extractSessionStats` returns for `contextWindow` is necessarily an `inferContextWindow(modelId)` heuristic that pins Claude to `200_000` and ignores 1M variants. The persisted `meta.contextWindow` came from a live `turn_end` event carrying the LLM's reported value and is the only reliable source.

#### Scenario: Stale cache re-extract preserves persisted contextWindow when model unchanged
- **GIVEN** a `.meta.json` with `model: "anthropic/claude-sonnet-4-20250514"` and `contextWindow: 1_000_000`
- **AND** the `.jsonl` mtime is newer than `meta.cachedAt` (forcing re-extract)
- **AND** `extractSessionStats` returns the same model with an inferred `contextWindow: 200_000`
- **WHEN** the scanner merges stats into meta
- **THEN** the resulting `contextWindow` SHALL be `1_000_000`
- **AND** the persisted `.meta.json` SHALL still report `contextWindow: 1_000_000`

#### Scenario: Stale cache re-extract adopts inferred contextWindow when model changes
- **GIVEN** a `.meta.json` with `model: "openai/gpt-4o"` and `contextWindow: 128_000`
- **AND** the `.jsonl` mtime is newer than `meta.cachedAt`
- **AND** `extractSessionStats` returns a different model `"anthropic/claude-sonnet-4-20250514"` with `contextWindow: 200_000`
- **WHEN** the scanner merges stats into meta
- **THEN** the resulting `model` SHALL be `"anthropic/claude-sonnet-4-20250514"`
- **AND** the resulting `contextWindow` SHALL be `200_000`

#### Scenario: First-extract path infers contextWindow when no meta exists
- **GIVEN** a `.jsonl` file with no corresponding `.meta.json`
- **WHEN** the scanner falls back to `.jsonl` parsing and writes a fresh `.meta.json`
- **THEN** `contextWindow` SHALL be the value returned by `extractSessionStats` (which is `inferContextWindow(model)`)
