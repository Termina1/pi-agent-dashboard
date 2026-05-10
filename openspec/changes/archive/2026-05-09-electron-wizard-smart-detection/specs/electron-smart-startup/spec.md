## ADDED Requirements

### Requirement: Pre-wizard server health check
The Electron main process SHALL check if the dashboard server is already running via `/api/health` before evaluating the first-run wizard gate. If the server is running and `mode.json` does not exist, the system SHALL auto-write `mode.json` with mode `"power-user"`, register the bundled bridge extension, and skip the wizard entirely.

#### Scenario: Server already running, no mode.json
- **WHEN** the Electron app starts and the dashboard server responds to `/api/health` with `ok: true`
- **AND** `~/.pi-dashboard/mode.json` does not exist
- **THEN** the system writes `mode.json` with `mode: "power-user"`, registers the bundled bridge extension in `settings.json`, and proceeds to `ensureServer()` without opening the wizard

#### Scenario: Server already running, mode.json exists
- **WHEN** the Electron app starts and the dashboard server responds to `/api/health` with `ok: true`
- **AND** `~/.pi-dashboard/mode.json` already exists
- **THEN** the system proceeds to `ensureServer()` without opening the wizard (existing behavior)

#### Scenario: Server not running
- **WHEN** the Electron app starts and the dashboard server does not respond (ECONNREFUSED or timeout)
- **THEN** the system continues to the `isFirstRun()` check and smart detection flow

### Requirement: Bridge detection via settings.json
The dependency detector SHALL check `~/.pi/agent/settings.json` packages array for bridge registration. An entry SHALL be considered a bridge match if it contains the substring `pi-dashboard` or `pi-agent-dashboard`. This check SHALL be combined with existing npm location checks — either source matching means `found: true`.

#### Scenario: Bridge registered as local dev path
- **WHEN** `settings.json` packages contains `"../../Project/pi-agent-dashboard"`
- **THEN** `detectBridgeExtension()` returns `{ found: true, source: "settings" }`

#### Scenario: Bridge registered as bundled extension
- **WHEN** `settings.json` packages contains a path with `pi-agent-dashboard` in it (e.g., `/Applications/PI Dashboard.app/.../packages/extension`)
- **THEN** `detectBridgeExtension()` returns `{ found: true, source: "settings" }`

#### Scenario: Bridge registered as npm package reference
- **WHEN** `settings.json` packages contains `"npm:@blackbelt-technology/pi-dashboard"`
- **THEN** `detectBridgeExtension()` returns `{ found: true, source: "settings" }`

#### Scenario: Bridge installed as npm global package
- **WHEN** `settings.json` does not contain a matching entry
- **AND** `@blackbelt-technology/pi-agent-dashboard/package.json` exists in the global npm root
- **THEN** `detectBridgeExtension()` returns `{ found: true, source: "system" }`

#### Scenario: Bridge not found anywhere
- **WHEN** `settings.json` does not contain a matching entry
- **AND** no npm package is found in managed or global locations
- **THEN** `detectBridgeExtension()` returns `{ found: false }`

### Requirement: pi-dashboard CLI detection
The dependency detector SHALL detect `pi-dashboard` on the system PATH. The detection SHALL exclude npx cache shims (paths containing `.npm/_npx/`) to avoid matching ephemeral installs.

#### Scenario: pi-dashboard installed globally
- **WHEN** `which pi-dashboard` resolves to a path NOT containing `.npm/_npx/`
- **THEN** `detectPiDashboardCli()` returns `{ found: true, source: "system", path: "<resolved>" }`

#### Scenario: pi-dashboard only in npx cache
- **WHEN** `which pi-dashboard` resolves to a path containing `.npm/_npx/`
- **THEN** `detectPiDashboardCli()` returns `{ found: false }`

#### Scenario: pi-dashboard not on PATH
- **WHEN** `which pi-dashboard` fails
- **THEN** `detectPiDashboardCli()` returns `{ found: false }`

### Requirement: Login shell PATH resolution
On macOS and Linux, when a command is not found on the process PATH, the dependency detector SHALL retry using a login shell (`$SHELL -ilc "which <cmd>"`) to pick up paths configured in shell rc files (nvm, volta, homebrew, fnm). The resolver SHALL extract the path from noisy login shell output by finding the first line starting with `/`.

#### Scenario: Command found via login shell (nvm)
- **WHEN** `which pi` fails on the process PATH
- **AND** `$SHELL -ilc "which pi"` succeeds with output containing session restore noise and the path
- **THEN** the resolver extracts the absolute path (line starting with `/`) and returns it

#### Scenario: Login shell also fails
- **WHEN** `which pi` fails on the process PATH
- **AND** `$SHELL -ilc "which pi"` also fails or produces no absolute path
- **THEN** the resolver returns `null`

#### Scenario: Windows (no login shell fallback)
- **WHEN** the platform is `win32`
- **THEN** only the process PATH is checked (no login shell fallback)

### Requirement: Auto-skip wizard when fully configured
When `isFirstRun()` is true but dependency detection finds both pi CLI and bridge extension, the system SHALL auto-write `mode.json` with mode `"power-user"`, register the bundled bridge extension, and skip the wizard without user interaction.

#### Scenario: Pi and bridge both detected, first run
- **WHEN** `mode.json` does not exist
- **AND** the server is not running
- **AND** `detectPi()` returns `found: true`
- **AND** `detectBridgeExtension()` returns `found: true`
- **THEN** the system writes `mode.json` with `mode: "power-user"`, registers the bundled bridge extension, and proceeds to `ensureServer()`

### Requirement: Targeted wizard for missing bridge
When pi CLI is detected but bridge extension is not, the wizard SHALL open directly at a bridge installation step, skipping the mode-choice screen. The bridge install step SHALL offer the user a choice between registering the bundled extension path or installing the global npm package.

#### Scenario: Pi installed, bridge missing
- **WHEN** `mode.json` does not exist
- **AND** the server is not running
- **AND** `detectPi()` returns `found: true`
- **AND** `detectBridgeExtension()` returns `found: false`
- **THEN** the wizard opens at the bridge-install step (not the mode-choice step)

#### Scenario: Nothing installed
- **WHEN** `mode.json` does not exist
- **AND** the server is not running
- **AND** `detectPi()` returns `found: false`
- **THEN** the wizard opens at the mode-choice step (existing behavior)

### Requirement: Bundled bridge registration on power-user completion
Every code path that sets mode to `"power-user"` SHALL also register the Electron app's bundled bridge extension in `~/.pi/agent/settings.json`. This includes auto-skip paths (server running, pi+bridge detected) and wizard completion. Registration SHALL be non-fatal — failure is silently ignored since the server re-registers on start.

#### Scenario: Power-user mode via wizard completion
- **WHEN** the wizard completes with mode `"power-user"`
- **THEN** the bundled bridge extension path is registered in `settings.json` packages array

#### Scenario: Power-user mode via auto-skip (server running)
- **WHEN** the server is already running and mode.json is auto-written as `"power-user"`
- **THEN** the bundled bridge extension path is registered in `settings.json` packages array

#### Scenario: Power-user mode via auto-skip (pi+bridge detected)
- **WHEN** pi and bridge are detected and mode.json is auto-written as `"power-user"`
- **THEN** the bundled bridge extension path is registered in `settings.json` packages array

#### Scenario: Registration failure is non-fatal
- **WHEN** `registerBundledBridgeExtension()` throws (e.g., AppImage temp path)
- **THEN** the error is silently caught and startup continues normally

### Requirement: Cross-platform bundled extension path resolution
The bundled extension finder SHALL use Electron's `process.resourcesPath` to locate the extension directory. The path SHALL be stable across macOS (.app), Linux (deb/rpm), and Windows (NSIS). Linux AppImage paths (containing `/tmp/.mount_`) SHALL be rejected as unstable.

#### Scenario: macOS packaged app
- **WHEN** `process.resourcesPath` is `/Applications/PI Dashboard.app/Contents/Resources`
- **THEN** the extension is found at `<resourcesPath>/server/packages/extension`

#### Scenario: Linux deb/rpm install
- **WHEN** `process.resourcesPath` is `/usr/lib/pi-dashboard/resources`
- **THEN** the extension is found at `<resourcesPath>/server/packages/extension`

#### Scenario: Windows NSIS install
- **WHEN** `process.resourcesPath` is `C:\Program Files\PI Dashboard\resources`
- **THEN** the extension is found at `<resourcesPath>\server\packages\extension`

#### Scenario: Linux AppImage (rejected)
- **WHEN** `process.resourcesPath` resolves to a path under `/tmp/.mount_*`
- **THEN** `findBundledExtension()` returns `null` and logs a warning

#### Scenario: Development mode
- **WHEN** `process.resourcesPath` is not set
- **THEN** the extension is found relative to `__dirname` at `../../../extension`

### Requirement: Mode-aware server discovery
The server discovery in `ensureServer()` SHALL vary the candidate order based on the persisted mode. In power-user mode, `pi-dashboard` CLI on PATH SHALL be preferred, launched via direct `spawn("pi-dashboard", ["start", ...])`. In standalone mode, the bundled server SHALL be preferred. Both modes SHALL check health first.

#### Scenario: Power-user mode, pi-dashboard on PATH
- **WHEN** mode is `"power-user"`
- **AND** the server is not already running
- **AND** `pi-dashboard` CLI is found on PATH (not npx cache)
- **THEN** the server is launched via `spawn("pi-dashboard", ["start", "--port", "<port>", "--pi-port", "<piPort>"])`

#### Scenario: Power-user mode, pi-dashboard not on PATH
- **WHEN** mode is `"power-user"`
- **AND** the server is not already running
- **AND** `pi-dashboard` CLI is NOT on PATH
- **THEN** the system falls back to managed install, then bundled server (existing tsx + cli.ts resolution)

#### Scenario: Standalone mode
- **WHEN** mode is `"standalone"`
- **AND** the server is not already running
- **THEN** the system prefers bundled server, then managed install, then `pi-dashboard` CLI on PATH

#### Scenario: Server already running (any mode)
- **WHEN** the health check finds the server already running
- **THEN** the system connects directly regardless of mode

### Requirement: Standalone mode skips existing installations
When standalone mode is selected and dependency detection shows tools already installed on the system, the installation step SHALL skip those tools and mark them as already installed.

#### Scenario: Pi already on system PATH
- **WHEN** user selects standalone mode
- **AND** `detectPi()` returns `found: true, source: "system"`
- **THEN** the pi installation step shows "✓ Already installed (system)" and is not re-installed

#### Scenario: OpenSpec already on system PATH
- **WHEN** user selects standalone mode
- **AND** `detectOpenSpec()` returns `found: true, source: "system"`
- **THEN** the openspec installation step shows "✓ Already installed (system)" and is not re-installed

#### Scenario: No tools installed
- **WHEN** user selects standalone mode
- **AND** no tools are detected on the system
- **THEN** all tools are installed as normal (existing behavior)

### Requirement: Consistent naming in detection and cleanup
All substring matching and npm path lookups SHALL use `pi-agent-dashboard` (the actual npm/git name). Stale path cleanup SHALL match both `pi-dashboard` and `pi-agent-dashboard` to cover all historical registration formats.

#### Scenario: npm global path lookup
- **WHEN** checking for the dashboard package in the global npm root
- **THEN** the path uses `@blackbelt-technology/pi-agent-dashboard` (not `pi-dashboard`)

#### Scenario: Stale path cleanup
- **WHEN** registering a new extension path in `settings.json`
- **THEN** existing local paths containing either `pi-dashboard` or `pi-agent-dashboard` are removed before adding the new one

---

## Phase 1.5 — Gap Fixes

### Requirement: Jiti fallback for server launch
When `launchServer()` cannot find tsx, it SHALL attempt to resolve jiti from the pi installation as a fallback TypeScript loader. Resolution order: managed pi (`~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent/`) → system pi (via `detectPi()` path). If jiti is found, the server SHALL be spawned via `spawn(node, ["--import", jitiPath, cliPath, ...args])`.

#### Scenario: Pi installed via nvm, no tsx, no pi-dashboard CLI, Electron DMG
- **WHEN** the bridge-install wizard completes as `power-user`
- **AND** `resolveTsxCommand()` returns null
- **AND** `detectPiDashboardCli()` returns `found: false`
- **AND** pi is installed and contains jiti
- **THEN** `launchServer()` resolves jiti from pi's package tree and spawns the server with `--import <jiti-register.mjs>`

#### Scenario: Neither tsx nor jiti available
- **WHEN** `resolveTsxCommand()` returns null
- **AND** jiti cannot be resolved from any pi installation
- **THEN** `launchServer()` throws an error with message indicating both tsx and pi are needed

### Requirement: Non-destructive bridge registration
Bridge registration cleanup SHALL only remove paths from `settings.json` packages array where the target directory does not exist on disk OR does not contain a `package.json`. Existing valid extension paths SHALL be preserved regardless of whether they contain `pi-dashboard` or `pi-agent-dashboard` in the path.

#### Scenario: User has dev registration, Electron registers bundled path
- **WHEN** `settings.json` packages contains `"../../Project/pi-agent-dashboard"` pointing to an existing directory with package.json
- **AND** `registerBridgeExtension()` is called with the Electron bundled path
- **THEN** the dev path is preserved
- **AND** the bundled path is added (if not already present)
- **AND** both entries coexist in the packages array

#### Scenario: Stale path from old install
- **WHEN** `settings.json` packages contains `"/old/path/pi-dashboard/extension"` and that directory does NOT exist
- **AND** `registerBridgeExtension()` is called with a new path
- **THEN** the stale `/old/path/...` entry is removed
- **AND** the new path is added

#### Scenario: Path already registered
- **WHEN** `registerBridgeExtension()` is called with a path already in the packages array
- **THEN** no duplicate is added (idempotent)

### Requirement: AppImage guard in server bridge registration
The server's bridge extension registration SHALL reject extension paths under temporary AppImage mounts (`/tmp/.mount_*`). This applies to both the current `extension-register.ts` and the Phase 2 shared `bridge-register.ts`.

#### Scenario: Server running inside AppImage
- **WHEN** the server's `findBundledExtension()` resolves to a path containing `/tmp/.mount_`
- **THEN** it returns `null` and logs a warning
- **AND** no entry is written to `settings.json`

#### Scenario: Server running from permanent install (deb, global npm, macOS DMG)
- **WHEN** the server's `findBundledExtension()` resolves to a stable path (not under `/tmp/.mount_`)
- **THEN** registration proceeds normally

### Requirement: Health check version field
The `/api/health` response SHALL include a `version` field read from the server's `package.json`. `ensureServer()` in the Electron app SHALL compare the reported version against the expected version and log a warning on mismatch. Version mismatch SHALL NOT block the connection.

#### Scenario: Version match
- **WHEN** `ensureServer()` confirms the server is running
- **AND** the `/api/health` version matches the Electron app's expected version
- **THEN** startup proceeds without warnings

#### Scenario: Version mismatch (old server)
- **WHEN** `ensureServer()` confirms the server is running
- **AND** the `/api/health` version does NOT match (or is missing)
- **THEN** a warning is logged: "Dashboard server version X does not match expected version Y"
- **AND** startup proceeds normally (no blocking)

#### Scenario: Server predates version field
- **WHEN** the `/api/health` response does not contain a `version` field
- **THEN** this is treated as a mismatch and a warning is logged

---

## Phase 2 — Unified Tool Resolver

### Requirement: Shared managed path constants
All references to the managed install directory (`~/.pi-dashboard/`) and its bin subdirectory SHALL use constants imported from a single shared module (`packages/shared/src/managed-paths.ts`). No module SHALL define its own `MANAGED_DIR` or `MANAGED_BIN` constant.

#### Scenario: Managed dir constant usage
- **WHEN** any module in `packages/electron/`, `packages/server/`, or `packages/shared/` needs the managed install path
- **THEN** it imports `MANAGED_DIR` from `@blackbelt-technology/pi-dashboard-shared/managed-paths.js`
- **AND** does NOT define a local `const MANAGED_DIR = ...`

### Requirement: Unified binary resolution via ToolResolver
All binary resolution (pi, tsx, node, openspec, pi-dashboard) SHALL use a shared `ToolResolver` class from `packages/shared/src/tool-resolver.ts`. The resolver SHALL accept a `ResolverContext` at construction time and apply a unified search order: managed bin → extra bin dirs → system PATH → login shell (when enabled).

#### Scenario: Electron GUI binary resolution
- **WHEN** the Electron app needs to find pi, tsx, or node
- **THEN** it creates a `ToolResolver` with `{ useLoginShell: true, extraBinDirs: [bundledNodeDir] }`
- **AND** calls `resolver.resolvePi()`, `resolver.resolveTsx()`, or `resolver.resolveNode()`

#### Scenario: Server binary resolution for session spawning
- **WHEN** the server's process-manager needs to find the pi binary
- **THEN** it creates a `ToolResolver` with `{ processExecPath: process.execPath }`
- **AND** calls `resolver.resolvePi()` instead of its own `resolvePiCommand()`

#### Scenario: Search order consistency
- **GIVEN** a `ToolResolver` with default context
- **WHEN** `which("pi")` is called
- **THEN** the search order is: managed bin (`~/.pi-dashboard/node_modules/.bin/pi`) → extra bin dirs → system PATH → login shell fallback (if enabled)

#### Scenario: Windows .cmd avoidance
- **WHEN** `resolvePi()` or `resolveTsx()` is called on Windows
- **THEN** the resolver returns `[node.exe, entry-point.js]` instead of a `.cmd` shim path
- **AND** the caller can spawn without `shell: true`

### Requirement: Unified spawn environment
`ToolResolver.buildSpawnEnv()` SHALL produce a single unified `PATH` and `NODE_PATH` combining: managed bin dir, current Node binary dir, extra bin dirs from context, and common user bin dirs (`~/.local/bin`, `/usr/local/bin`, etc.). This SHALL replace both `buildSpawnEnv()` in `process-manager.ts` and the ad-hoc PATH construction in `server-lifecycle.ts`.

#### Scenario: Server process-manager env
- **WHEN** spawning a headless pi session
- **THEN** `resolver.buildSpawnEnv()` is used instead of the local `buildSpawnEnv()` function
- **AND** the resulting PATH includes managed bin, node bin, and user bin dirs

#### Scenario: Electron server launch env
- **WHEN** launching the dashboard server from Electron
- **THEN** `resolver.buildSpawnEnv()` is used instead of manually concatenating pi/node/tsx dirs
- **AND** the resulting PATH includes all necessary directories

### Requirement: Shared bridge registration
Bridge extension registration in `~/.pi/agent/settings.json` SHALL be implemented in a single shared module (`packages/shared/src/bridge-register.ts`). The module SHALL export `registerBridgeExtension(extensionPath: string)` and `findBundledExtension(baseDir: string)`. The server and Electron packages SHALL NOT have their own registration implementations.

#### Scenario: Server registers bridge on startup
- **WHEN** the dashboard server starts
- **THEN** it calls `registerBridgeExtension(findBundledExtension(serverBaseDir)!)` from the shared module
- **AND** does NOT use a local `extension-register.ts`

#### Scenario: Electron wizard registers bridge
- **WHEN** the Electron wizard completes in power-user mode
- **THEN** it calls `registerBridgeExtension(findBundledExtension(resourcesServerDir)!)` from the shared module
- **AND** does NOT use a local `bridge-register.ts`

#### Scenario: Stale path cleanup in shared module
- **WHEN** `registerBridgeExtension()` adds a new path
- **THEN** it removes existing local paths containing `pi-dashboard` or `pi-agent-dashboard` (same cleanup logic as Phase 1, now in one place)

### Requirement: No behavioral changes from refactoring
Phase 2 SHALL NOT change any user-facing behavior, protocol messages, configuration format, or wizard flow. All changes are internal: import sources change, local implementations are deleted, shared implementations are used. Existing tests SHALL continue to pass without modification (or with import path updates only).
