## Why

The Electron app's first-run wizard and server discovery have three interrelated problems:

1. **Blind bridge detection**: `detectDashboardPackage()` only checks two npm locations but is blind to bridge extensions registered in pi's `settings.json` packages array — the actual source of truth. Power users with dev/source installs see ✗ for "Dashboard bridge" even when everything is operational.

2. **No pre-wizard server check**: The wizard gate is purely `isFirstRun()` (mode.json exists?) with no health check. The wizard appears even when the dashboard server is already running.

3. **Shadow installs and ignored global server**: When "Setup everything" is selected on a machine that already has pi/openspec/pi-dashboard installed globally, the wizard installs duplicate copies into `~/.pi-dashboard/` (~300MB+ wasted). The Electron app then uses its bundled server, completely ignoring the user's global `pi-dashboard` CLI. This can also cause double bridge registration and version divergence between bundled and global server.

4. **`findServerCli()` misses global npm installs**: The server discovery only checks bundled, dev, and managed paths — never the global npm root. Even after `npm install -g @blackbelt-technology/pi-agent-dashboard`, the Electron app can't find it. Meanwhile, the global `pi-dashboard` CLI is self-contained (has its own tsx, handles start/stop) and could be spawned directly.

5. **Binary resolution duplicated 3× with different search orders**: `dependency-detector.ts` resolves pi via system PATH → login shell → managed bin. `process-manager.ts` resolves pi via managed bin first → system PATH. `server-lifecycle.ts` resolves tsx via managed → system. Each uses different code doing the same job with different search priorities. PATH augmentation (`buildSpawnEnv()` in process-manager vs manual construction in server-lifecycle) is also duplicated with different sets of directories.

6. **Bridge registration duplicated 2×**: `packages/server/src/extension-register.ts` and `packages/electron/src/lib/bridge-register.ts` are nearly identical (~80 lines each) with the same `readSettings`/`writeSettings`/`findBundledExtension`/stale-path-cleanup logic. The only difference is the `__dirname` anchor for `findBundledExtension()`.

7. **`MANAGED_DIR` constant defined 5× independently**: `dependency-detector.ts`, `dependency-installer.ts`, `doctor.ts`, `server-lifecycle.ts`, and `ts-loader-resolver.ts` each independently define `const MANAGED_DIR = path.join(os.homedir(), ".pi-dashboard")`.

8. **Server launch has 3 completely different code paths**: The extension uses `process.execPath` + jiti. Electron standalone uses tsx + `cli.ts`. Electron power-user uses `pi-dashboard` CLI. Three different TypeScript loaders, three different PATH constructions, three different error handling flows for the same server.

9. **Bridge-install wizard path dead-ends without TS loader**: When pi is installed but neither tsx nor pi-dashboard CLI exist, the bridge-install wizard forces `power-user` mode. Then `ensureServer()` falls through to `launchServer()` which requires tsx to run the bundled `cli.ts`. tsx is not installed anywhere → crash. The user has pi (which bundles jiti), but `launchServer()` doesn't know how to use it.

10. **Aggressive stale-path cleanup destroys intentional registrations**: `registerBundledBridgeExtension()` removes ALL local paths containing `pi-dashboard` or `pi-agent-dashboard` before adding the Electron bundle's path. This silently deletes the user's dev-install registration (e.g. `../../Project/pi-agent-dashboard`) or global npm registration. The Electron app and server also fight over settings.json — whichever ran last overwrites the other's path.

11. **Server's extension-register.ts missing AppImage guard**: The Electron-side `bridge-register.ts` correctly rejects `/tmp/.mount_*` AppImage paths, but the server's `extension-register.ts` has no such check. On AppImage, the server registers a temporary path that breaks when the AppImage is unmounted.

12. **No server version compatibility check**: `ensureServer()` and the pre-wizard health check validate that a server responds with `{ ok: true, pid }` but never check version compatibility. An old global `pi-dashboard` server may lack APIs the new Electron client expects.

13. **Inconsistent `pi-dashboard` vs `pi-agent-dashboard` naming**: The git repo and npm package are `pi-agent-dashboard`, but the CLI binary is `pi-dashboard` and sub-packages use `pi-dashboard-*`. Code that does substring matching or path lookups uses the wrong variant in several places: `detectDashboardPackage()` looks for `@blackbelt-technology/pi-dashboard/` (doesn't exist on npm — the real name is `pi-agent-dashboard`), and `extension-register.ts` only cleans stale paths containing `pi-dashboard` but dev paths contain `pi-agent-dashboard`, so duplicates accumulate.

## What Changes

- **Pre-wizard health check**: Before showing the wizard, check if the dashboard server is already running via `/api/health`. If running, auto-write `mode.json` and skip the wizard entirely.
- **Bridge detection via settings.json**: Replace `detectDashboardPackage()` with `detectBridgeExtension()` that scans `~/.pi/agent/settings.json` packages array for any entry containing `pi-dashboard`, in addition to the existing npm location checks.
- **Auto-skip when fully configured**: If pi + bridge detected, write `mode.json` silently and skip the wizard — don't show a screen of all ✓ checkmarks.
- **Targeted wizard for missing bridge only**: If pi is found but bridge is not registered, go directly to a bridge install step (register bundled extension path or install global npm package) instead of the full mode-choice screen.
- **Mode-aware server discovery**: Power-user mode prefers `pi-dashboard` CLI on PATH (spawned directly, no tsx resolution needed), then falls back to managed/bundled. Standalone mode prefers bundled server, then managed, then PATH. Both modes check health first.
- **"Setup everything" existing install guard**: When standalone mode is selected, skip packages already installed on the system. Show "✓ Already installed (system)" for pre-existing tools instead of installing shadow copies.
- **TS loader fallback for bridge-install path**: When the bridge-install wizard completes in power-user mode but neither tsx nor pi-dashboard CLI is available, resolve jiti from the managed or system pi installation as a fallback TypeScript loader for running the bundled server.
- **Non-destructive bridge registration**: Change stale-path cleanup to only remove paths that point to non-existent directories. Existing valid registrations are preserved. Multiple valid extension paths coexist.
- **AppImage guard in server bridge registration**: Add the same `/tmp/.mount_*` rejection to the server's (and shared) bridge registration module.
- **Health check version field**: Add a `version` field to `/api/health` response. `ensureServer()` logs a warning when the running server version doesn't match the Electron app's expected version.

## Capabilities

### New Capabilities
- `electron-smart-startup`: Pre-wizard detection logic that health-checks the running server, detects bridge registration in pi settings, and decides whether to skip the wizard, show targeted bridge install, or show the full wizard. Mode-aware server discovery that respects power-user vs standalone preferences for server launch order.

### Modified Capabilities
<!-- No existing spec-level requirement changes — this is a fix/improvement to Electron app startup behavior -->

### Phase 2 — Unified Tool Resolver (Post-Implementation Refactor)
- `tool-resolver`: Single binary resolution module replacing 3 scattered implementations (`dependency-detector.ts` `whichSync`, `server-lifecycle.ts` `resolveTsxCommand`, `process-manager.ts` `resolvePiCommand`). Configurable via context (Electron GUI with login-shell fallback vs server vs extension).
- `bridge-register-shared`: Extract bridge registration from 2 near-identical modules (`packages/server/src/extension-register.ts` and `packages/electron/src/lib/bridge-register.ts`) into a single shared module parameterized by base directory.
- `managed-paths`: Extract the `MANAGED_DIR` / `MANAGED_BIN` constants duplicated 5× across Electron modules into a single shared module.
- `spawn-env-builder`: Unify `buildSpawnEnv()` (process-manager) and the ad-hoc PATH construction in `server-lifecycle.ts` into one shared environment builder.

## Impact

- **Files (Phase 1.5 — gap fixes)**:
  - `packages/electron/src/lib/server-lifecycle.ts` — jiti fallback in `launchServer()` when tsx not found
  - `packages/electron/src/lib/bridge-register.ts` — non-destructive cleanup (only remove broken paths)
  - `packages/server/src/extension-register.ts` — AppImage guard, non-destructive cleanup
  - `packages/server/src/server.ts` — add `version` field to `/api/health`
  - `packages/electron/src/lib/health-check.ts` — version compatibility warning
- **Files (Phase 1 — complete)**:
  - `packages/electron/src/lib/dependency-detector.ts` — new `detectBridgeExtension()`, new `detectPiDashboardCli()`
  - `packages/electron/src/lib/server-lifecycle.ts` — mode-aware `findServerCli()` and `launchServer()`, support for spawning `pi-dashboard` CLI directly
  - `packages/electron/src/main.ts` — pre-wizard health check, three-tier skip logic
  - `packages/electron/src/renderer/wizard.html` — bridge-install step, existing install guards, start-step query param
  - `packages/electron/src/lib/wizard-ipc.ts` — expose new detection data
  - `packages/electron/src/lib/wizard-state.ts` — auto-write mode.json helper
  - `packages/electron/src/lib/wizard-window.ts` — pass start-step parameter
  - `packages/electron/src/lib/dependency-installer.ts` — skip already-installed packages
  - `src/server/extension-register.ts` — fix stale path cleanup to match both `pi-dashboard` and `pi-agent-dashboard`
- **Files (Phase 2 — unified tool resolver)**:
  - `packages/shared/src/managed-paths.ts` — NEW: shared `MANAGED_DIR`, `MANAGED_BIN`, `PI_SETTINGS_PATH` constants
  - `packages/shared/src/tool-resolver.ts` — NEW: `ToolResolver` class with configurable context, replaces `whichSync`, `resolvePiCommand`, `resolveTsxCommand`, `detectSystemNode`, `buildSpawnEnv`
  - `packages/shared/src/bridge-register.ts` — NEW: shared `registerBridgeExtension(extensionPath)` and `findBundledExtension(baseDir)`
  - `packages/electron/src/lib/dependency-detector.ts` — simplified: delegates to `ToolResolver`
  - `packages/electron/src/lib/server-lifecycle.ts` — simplified: uses `ToolResolver` for tsx/node/pi resolution and `buildSpawnEnv()`
  - `packages/electron/src/lib/bridge-register.ts` — DELETE: replaced by shared module
  - `packages/electron/src/lib/dependency-installer.ts` — uses shared `MANAGED_DIR`
  - `packages/electron/src/lib/doctor.ts` — uses shared `MANAGED_DIR`
  - `packages/electron/src/lib/ts-loader-resolver.ts` — uses shared `MANAGED_DIR`
  - `packages/server/src/extension-register.ts` — DELETE: replaced by shared module
  - `packages/server/src/process-manager.ts` — simplified: uses `ToolResolver` for pi resolution and `buildSpawnEnv()`
  - `packages/server/src/editor-detection.ts` — uses shared `buildSpawnEnv()` from `ToolResolver`
  - `packages/server/src/editor-manager.ts` — uses shared `buildSpawnEnv()` from `ToolResolver`
  - `packages/server/src/server.ts` — imports from shared bridge-register instead of local
- **No breaking changes**: Existing `mode.json` files continue to work; the wizard can still be triggered manually via Doctor → Run Setup. Phase 2 is purely internal refactoring — no protocol, config, or user-facing changes.
