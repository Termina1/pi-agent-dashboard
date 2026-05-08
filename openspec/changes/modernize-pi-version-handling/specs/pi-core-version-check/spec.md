## ADDED Requirements

### Requirement: Current pi version reads through ToolRegistry

`readCurrentPiVersion()` in `packages/server/src/pi-version-skew.ts` SHALL resolve pi via the shared `ToolRegistry`, never via a parallel `createRequire` walk. Resolution order:

1. `registry.resolve("pi-coding-agent")` (module-kind tool with `dist/index.js` entry). If `ok`, the package directory is `dirname(dirname(path))` and `package.json` lives at `<pkgDir>/package.json`.
2. Else `registry.resolve("pi")` (executor-kind tool). If `ok`:
   - If `path` ends with `.cmd` or `.bat`, return `undefined` rather than guessing — Windows `.cmd` shims do NOT sit at a fixed depth relative to `package.json`.
   - Otherwise `realpath(path)`, walk `dirname` twice, read `package.json`.
3. Else return `undefined`.

The function SHALL NOT use `createRequire(import.meta.url).resolve(...)` directly. The registry's `bare-import` strategy already covers that case as part of its chain.

#### Scenario: Managed-only install resolves through registry
- **WHEN** pi is installed only at `~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent`
- **AND** `registry.resolve("pi-coding-agent")` succeeds via the `managed` strategy
- **THEN** `readCurrentPiVersion()` SHALL read the version from `<managed>/.../pi-coding-agent/package.json` and return it

#### Scenario: Windows .cmd shim returns undefined explicitly
- **WHEN** `registry.resolve("pi")` returns a `.cmd` path (e.g. `C:\Users\foo\AppData\Roaming\npm\pi.cmd`)
- **AND** `registry.resolve("pi-coding-agent")` is not registered or fails
- **THEN** `readCurrentPiVersion()` SHALL return `undefined` rather than emitting a wrong version derived from the shim's path

#### Scenario: Unix npm-bin chain still works
- **WHEN** `registry.resolve("pi")` returns `/usr/local/bin/pi` (a symlink) and `realpath` resolves to `.../pi-coding-agent/dist/cli.js`
- **THEN** `readCurrentPiVersion()` SHALL still return the version from `.../pi-coding-agent/package.json` via the dirname-twice fallback

### Requirement: Version-skew cache invalidates with registry rescan

`runPostInstallRepair()` in `packages/server/src/server.ts` SHALL invalidate the 60-second `pi-version-skew` cache (via `_resetVersionSkewCache()`) immediately after calling `registry.rescan()`. The two caches share a single signal — the bootstrap state transitioning to `ready` — and SHALL invalidate together.

#### Scenario: Post-install banner reflects new version immediately
- **WHEN** `triggerUpgradePi` flips bootstrap state from `installing → ready`
- **AND** `runPostInstallRepair` runs
- **THEN** the next `GET /api/bootstrap/status` SHALL return `compatibility.current` matching the just-installed version, with NO 60-second lag from the previous cached value

### Requirement: Server invalidates caches on pi_version_update

On receipt of a `pi_version_update` message from any bridge, the server SHALL:

1. Call `registry.rescan("pi")` and `registry.rescan("pi-coding-agent")` on the default `ToolRegistry`, invalidating cached resolutions for both names.
2. Call `_resetVersionSkewCache()` to drop the 60-second cached compatibility result.
3. Call `updateBootstrapCompatibility(...)` to recompute compatibility against the current `piCompatibility` block in `packages/server/package.json`.
4. Broadcast the resulting `bootstrap_status` payload to every connected browser subscriber.

The four steps SHALL be performed via a shared helper `refreshPiCompatibilityState` so that `runPostInstallRepair` and the `pi_version_update` handler are guaranteed to follow the same recipe in the same order.

#### Scenario: Out-of-band upgrade reflected within 60 seconds
- **WHEN** the user runs `pi update --self` and pi resolves to a newer version
- **AND** the bridge's 60-second poll fires and emits `pi_version_update`
- **THEN** the server SHALL invalidate registry caches, recompute compatibility, and broadcast `bootstrap_status` so the UI banner updates without a page reload

#### Scenario: Same version push is idempotent
- **WHEN** the server receives a `pi_version_update` whose `version` equals the value already in `bootstrapState.compatibility.current`
- **THEN** the server SHALL still rescan + reset (cheap, idempotent) and broadcast — but the broadcast payload SHALL be unchanged from the prior state, so browser-side reducers can no-op

## MODIFIED Requirements

### Requirement: piCompatibility block tracks current upstream pi-coding-agent

The `packages/server/package.json` `piCompatibility` block SHALL declare a `recommended` version that is no more than one minor release behind the latest published `@mariozechner/pi-coding-agent` and a `minimum` version that matches the version actually exercised in the dashboard's tests and bundled offline cache.

After this change, the values SHALL be:

- `minimum: "0.73.0"`
- `recommended: "0.73.0"`
- `maximum: null`

`minimum` is intentionally pinned in lockstep with `recommended`. The dashboard does NOT maintain backward compatibility for older pi versions — keeping `minimum` at the same value as `recommended` removes the need for any conditional code paths or dual-import shims.

#### Scenario: Recommended version drives the upgrade hint
- **WHEN** the running pi-coding-agent version is below `piCompatibility.recommended`
- **THEN** `bootstrapState.compatibility.upgradeRecommended` is `true`
- **AND** the bootstrap status response is still `status: "ready"` (non-blocking)
