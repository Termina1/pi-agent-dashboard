## Context

The Electron app (`packages/electron/`) has a first-run wizard gated by `isFirstRun()` — which only checks if `~/.pi-dashboard/mode.json` exists. The wizard's power-user verification uses `detectDashboardPackage()` which only looks for the npm package in two locations (managed dir and global npm root). This misses dev/source installs where the bridge is registered in `~/.pi/agent/settings.json` packages array.

Additionally, `findServerCli()` in `server-lifecycle.ts` checks bundled, dev, and managed paths but never the global npm root. When `pi-dashboard` is installed globally, the Electron app can't find it. The global `pi-dashboard` CLI is self-contained (has its own tsx, handles start/stop) and could be spawned directly without the tsx + cli.ts resolution dance.

When "Setup everything" is selected on a machine with existing global installs, `installStandalone()` creates shadow copies of pi, openspec, and tsx in `~/.pi-dashboard/` (~300MB+ wasted), and the Electron app then uses its bundled server, ignoring the user's global `pi-dashboard` entirely.

Current files involved:
- `packages/electron/src/main.ts` — startup flow, wizard gate
- `packages/electron/src/lib/dependency-detector.ts` — detection functions
- `packages/electron/src/lib/dependency-installer.ts` — standalone/global install
- `packages/electron/src/lib/server-lifecycle.ts` — `ensureServer()`, `findServerCli()`, `launchServer()`
- `packages/electron/src/lib/wizard-ipc.ts` — IPC handlers exposing detection to renderer
- `packages/electron/src/lib/wizard-state.ts` — mode.json persistence
- `packages/electron/src/lib/wizard-window.ts` — wizard window creation
- `packages/electron/src/renderer/wizard.html` — wizard UI and flow logic

## Goals / Non-Goals

**Goals:**
- Skip the wizard entirely when the dashboard server is already running
- Detect bridge registration in pi's settings.json (not just npm package locations)
- Auto-skip when pi + bridge are both detected (no unnecessary ✓✓✓ screen)
- Show a targeted bridge-install step when pi exists but bridge is not registered
- Mode-aware server discovery: power-user prefers global `pi-dashboard` CLI, standalone prefers bundled
- Prevent shadow installations when tools already exist on the system

**Non-Goals:**
- Supporting detection of bridge via running WebSocket connections
- Changing the standalone installation flow beyond adding skip-if-exists guards
- Full server API versioning or backward-compatibility layer

## Decisions

### D1: Pre-wizard health check in main.ts

Add a health check call _before_ the `isFirstRun()` gate. If `isDashboardRunning()` returns `running: true`, auto-write `mode.json` as `"power-user"` and skip the wizard.

**Rationale**: The health check is already implemented in `server-lifecycle.ts` (inlined `isDashboardRunning`). Reusing it before the wizard gate is the minimal change. If the server is running, the user's setup is working — no wizard needed.

**Alternative considered**: Check settings.json first, then health check. Rejected because a running server is the strongest signal — it means bridge, server, and pi are all operational.

### D2: Bridge detection via settings.json packages array

Add `detectBridgeExtension()` to `dependency-detector.ts`. It reads `~/.pi/agent/settings.json`, parses the `packages` array, and checks if any entry contains `pi-dashboard` (substring match covers local paths, npm:, git:, and bundled extension paths). Falls back to existing npm location checks (managed + global).

**Rationale**: The `packages[]` array is the canonical registry for pi extensions. Substring match on `pi-dashboard` is simple and covers all known registration patterns:
- `"../../Project/pi-agent-dashboard"` (dev relative)
- `"/Users/.../packages/extension"` (bundled absolute)
- `"npm:@blackbelt-technology/pi-dashboard"` (npm reference)
- `"git:github.com/.../pi-dashboard"` (git reference)

**Alternative considered**: Exact package name matching. Rejected — too brittle given the variety of registration formats.

### D3: Three-tier wizard skip logic in main.ts

After the health check (D1), if `isFirstRun()` is true, run detection before opening the wizard:

```
Tier 1: Server running         → auto-skip (D1, handled above)
Tier 2: pi + bridge detected   → auto-write mode.json, skip wizard
Tier 3: pi found, no bridge    → open wizard at bridge-install step
Tier 4: nothing found          → open wizard at mode-choice step (existing)
```

Pass a `startStep` parameter to the wizard window via query string so it can skip straight to the relevant step.

**Rationale**: Each tier handles a progressively less-configured state. The user only sees wizard UI proportional to what's actually missing.

### D4: Wizard start-step parameter

Add a query parameter `?start=bridge-install` when opening `wizard.html` to skip directly to the bridge installation step. The wizard reads `URLSearchParams` on load and jumps to the appropriate step.

**Rationale**: Simpler than adding new IPC messages. The wizard already has step navigation (`goToStep()`). A query param is the minimal way to start at a non-default step.

### D5: Detect `pi-dashboard` CLI on PATH

Add `detectPiDashboardCli()` to `dependency-detector.ts` that checks if `pi-dashboard` is on PATH via `which`. This tells us the user has a global install with a self-contained CLI.

**Rationale**: The global `pi-dashboard` CLI has shebang `#!/usr/bin/env node --import tsx`, bundles its own tsx, and handles start/stop/restart. Detecting it enables direct spawning without manual tsx + cli.ts resolution.

### D6: Mode-aware server discovery in server-lifecycle.ts

Make `ensureServer()` read `mode.json` and vary the server search order:

**Power-user mode:**
1. Health check (already running?)
2. `pi-dashboard` CLI on PATH → `spawn("pi-dashboard", ["start", "--port", ...])`
3. Managed `~/.pi-dashboard/` install
4. Bundled `resources/server/`

**Standalone mode:**
1. Health check (already running?)
2. Bundled `resources/server/`
3. Managed `~/.pi-dashboard/` install
4. `pi-dashboard` CLI on PATH

When launching via the `pi-dashboard` CLI, use `spawn("pi-dashboard", ["start", "--port", String(port), "--pi-port", String(piPort)])` — no need to resolve tsx or cli.ts separately. The CLI is self-contained.

**Rationale**: Power users expect their globally installed version to be used. Standalone users expect the app's bundled version. Both fall through to alternatives if their primary isn't available.

**Alternative considered**: Always prefer bundled. Rejected — ignores power-user installs, causes version divergence, wastes the global install.

### D7: Standalone mode skip-if-exists guard

In `wizard.html`'s `runInstall()`, use the detection results (already available from `wizard:detect`) to mark already-installed items as ✓ and skip their npm install. In `dependency-installer.ts`, accept a skip list so `installStandalone()` doesn't re-install existing packages.

**Rationale**: The detection data is already fetched. The UI just needs to use it. This prevents ~300MB of shadow installs and avoids version divergence.

### D8: Extract health check utility

Extract the inlined `isDashboardRunning()` from `server-lifecycle.ts` into `packages/electron/src/lib/health-check.ts` so both `main.ts` (pre-wizard check) and `server-lifecycle.ts` (launch check) can use it without duplication.

**Rationale**: The function is currently inlined in `server-lifecycle.ts` to avoid importing shared packages in the packaged app. Extracting to a local utility within the electron package keeps that constraint while removing duplication.

## Phase 1.5 Decisions — Gap Fixes

### D14: Jiti fallback when tsx is not available

When `launchServer()` can't find tsx via `resolveTsxCommand()`, it SHALL attempt to resolve jiti from the pi installation (managed or system). Resolution chain:
1. Managed pi: `~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent/` → resolve jiti from there
2. System pi: `detectPi()` → resolve jiti from pi's package root
3. If jiti found: `spawn(node, ["--import", jitiPath, cliPath, ...args])`

**Rationale**: The bridge-install wizard path sets mode to `power-user` when the user already has pi installed. Pi bundles jiti. Using jiti as a fallback TS loader avoids requiring tsx to be installed separately. This is the same mechanism the extension's `server-launcher.ts` uses.

**Scenario**: User has pi (via nvm), no tsx, no pi-dashboard CLI, downloads Electron DMG. Bridge-install wizard completes → `ensureServer()` → `launchServer()` → tsx not found → resolves jiti from managed pi → spawns server with jiti → works.

**Alternative considered**: Install tsx as part of the bridge-install flow. Rejected — adds a slow npm install step to what should be a quick "register path" operation.

### D15: Non-destructive bridge registration

Change the stale-path cleanup in `registerBridgeExtension()` to only remove paths where the target directory **does not exist** or does not contain a `package.json`. Paths pointing to existing, valid extension directories are preserved.

Before (current):
```
Remove ALL local paths containing "pi-dashboard" or "pi-agent-dashboard"
Add new path
```

After:
```
Remove local paths containing "pi-dashboard" or "pi-agent-dashboard" WHERE
  the path does not exist on disk OR has no package.json
Add new path (if not already present)
```

**Rationale**: The current approach silently destroys the user's dev registration or global npm registration. A user who registered `../../Project/pi-agent-dashboard` via `settings.json` expects it to persist. Only broken/stale paths should be cleaned.

**Trade-off**: Multiple valid extension paths may accumulate (e.g., dev + bundled + global). Pi loads extensions from the packages list and should handle duplicates gracefully. If not, this is a pi-side concern.

### D16: AppImage guard in server-side bridge registration

Add the same `/tmp/.mount_*` path check that exists in `packages/electron/src/lib/bridge-register.ts` to the server's `extension-register.ts` (and the Phase 2 shared `bridge-register.ts`). When the resolved extension path is under a temporary AppImage mount, skip registration with a log warning.

**Rationale**: The server runs inside the same AppImage mount. When it calls `findBundledExtension()`, the path resolves to `/tmp/.mount_PIxxxx/resources/server/packages/extension`. This path disappears when the AppImage exits. Registering it in settings.json leaves a broken entry that pi can't load.

### D17: Health check version field

Add a `version` field to the `/api/health` response (read from server's `package.json`). In `ensureServer()`, after confirming the server is running, compare the reported version against the Electron app's expected version. On mismatch, log a warning (don't block — older servers still work for basic features).

**Rationale**: Catches the scenario where a user has an old global `pi-dashboard` and the Electron client calls APIs that don't exist. The warning helps debugging without being disruptive.

**Non-goal**: This is NOT a compatibility gate. The app still connects. A full versioned API compatibility layer is out of scope.

## Phase 2 Decisions — Unified Tool Resolver

### D9: Shared `managed-paths.ts` module

Extract `MANAGED_DIR`, `MANAGED_BIN`, and `PI_SETTINGS_PATH` into `packages/shared/src/managed-paths.ts`. All 5 Electron modules and the server's `process-manager.ts` import from there instead of defining their own constants.

**Rationale**: DRY. A path change (e.g. renaming `~/.pi-dashboard`) requires editing one file instead of five.

### D10: `ToolResolver` class with configurable context

Create `packages/shared/src/tool-resolver.ts` with a `ToolResolver` class initialized with a `ResolverContext`:

```typescript
interface ResolverContext {
  /** Extra bin dirs to search before system PATH (bundled Node, Electron resources) */
  extraBinDirs?: string[];
  /** Current process.execPath (for Node resolution when running inside pi/server) */
  processExecPath?: string;
  /** Use login shell fallback for GUI apps on macOS/Linux */
  useLoginShell?: boolean;
}
```

Unified search order for all `which()` calls: **managed bin → extraBinDirs → system PATH → login shell (if enabled)**.

Provides:
- `which(name)` — generic binary resolution
- `resolvePi()` — returns `[cmd, ...prefixArgs]` (handles Windows `.cmd` avoidance)
- `resolveTsx()` — returns `[cmd, ...prefixArgs]` (handles Windows node+mjs)
- `resolveNode()` — returns path or null
- `buildSpawnEnv(base?)` — unified PATH + NODE_PATH construction

**Callers create context-appropriate instances:**
- **Electron** (GUI app): `new ToolResolver({ useLoginShell: true, extraBinDirs: [bundledNodeDir] })`
- **Server** (process-manager): `new ToolResolver({ processExecPath: process.execPath })`
- **Extension** (inside pi): `new ToolResolver({ processExecPath: process.execPath })`

**Rationale**: One search-order implementation with different configurations replaces 3 divergent implementations. The context pattern avoids the shared package importing Electron-specific APIs.

**Alternative considered**: Standalone functions instead of a class. Rejected — the context (login shell, extra dirs) would need threading through every call. A class captures it once.

### D11: Shared `bridge-register.ts`

Extract bridge registration into `packages/shared/src/bridge-register.ts` with two functions:

```typescript
/** Find bundled extension relative to a base directory */
export function findBundledExtension(baseDir: string): string | null;

/** Register extension path in pi's settings.json (with stale path cleanup) */
export function registerBridgeExtension(extensionPath: string): void;
```

Server calls: `registerBridgeExtension(findBundledExtension(path.resolve(__dirname, "../.."))!)`
Electron calls: `registerBridgeExtension(findBundledExtension(resourcesPath + "/server")!)`

The `readSettings`/`writeSettings`/stale-cleanup logic exists once. Only the anchor path differs, passed by the caller.

**Rationale**: Eliminates ~80 lines of near-identical code across two packages. The anchor path is the only legitimate difference — parameterize it.

### D12: Unified `buildSpawnEnv()`

Move `buildSpawnEnv()` from `process-manager.ts` into `ToolResolver`. The method combines:
- Managed bin dir (`~/.pi-dashboard/node_modules/.bin/`)
- Current Node binary dir (`path.dirname(processExecPath)`)
- Extra bin dirs from context (bundled Node, Electron resources)
- Common user bin dirs (`~/.local/bin`, `/usr/local/bin`, etc.)

This replaces both `buildSpawnEnv()` in process-manager AND the manual PATH construction in `server-lifecycle.ts`'s `launchServer()`.

**Rationale**: The two implementations add different directories but the pattern is identical: "prepend important dirs to PATH if not already present". Merging them ensures spawned processes always have a complete PATH.

### D13: Consumers simplified, not changed

`process-manager.ts` keeps its `spawnHeadless()` and tmux logic but delegates binary resolution and env building to `ToolResolver`. `dependency-detector.ts` keeps its `DetectionResult` interface but `detectPi()`, `detectSystemNode()`, etc. delegate to `ToolResolver.which()`. `server-lifecycle.ts` uses `ToolResolver.resolveTsx()` instead of its own `resolveTsxCommand()`.

**Rationale**: Minimize blast radius. The refactoring changes WHERE resolution happens, not HOW processes are spawned or WHAT the wizard checks.

## Risks / Trade-offs

- **[Risk] Substring match on `pi-dashboard` could false-positive** → Mitigation: Extremely unlikely in practice. The string is specific enough. Tighten to known patterns if needed.
- **[Risk] Health check adds ~2s latency to cold start when server is not running** → Mitigation: ECONNREFUSED returns immediately (most common case). Only timeouts add delay, capped at 2s.
- **[Risk] Auto-writing mode.json may surprise users who want to re-run the wizard** → Mitigation: Doctor → Run Setup still works. The mode.json write is a convenience, not a lock-out.
- **[Risk] Global `pi-dashboard` CLI version may differ from Electron app expectations** → Mitigation: D17 adds a version field to `/api/health`. `ensureServer()` logs a warning on mismatch. Not a blocking gate — basic features still work with older servers.
- **[Risk] `spawn("pi-dashboard", ...)` may resolve to an npx shim instead of a proper global install** → Mitigation: `which pi-dashboard` returns the actual path. Validate it's not inside `.npm/_npx/` (npx cache) to avoid ephemeral installs.
- **[Trade-off] Mode-aware discovery adds branching complexity to `ensureServer()`** → Acceptable: The branching is a simple if/else on mode, and each branch is a reordering of the same candidates. The existing code already has multiple candidate paths.
- **[Risk] Phase 2 shared module adds cross-package dependency** → Mitigation: `packages/shared` is already a dependency of both server and electron. No new dependency edges.
- **[Risk] `ToolResolver` class in shared cannot import Electron APIs** → Mitigation: Electron-specific paths (`process.resourcesPath`, bundled Node) are passed via `ResolverContext.extraBinDirs`, never imported.
- **[Trade-off] Phase 2 touches many files for internal refactoring** → Acceptable: All changes are search-and-replace style (import from shared instead of local). No protocol, config, or behavioral changes. Easy to verify with existing tests.
