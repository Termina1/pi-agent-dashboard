## Why

The dashboard's pi version probe is broken in three ways that compound, and lifting the compatibility floor without fixing them ships a banner that lies. Three originally separate proposals (`fix-pi-version-probe-uses-registry`, `rescan-pi-after-self-update`, `bump-pi-compatibility-073`) addressed the three pieces; this change consolidates them into a single coordinated landing because they MUST land together — bumping the floor before fixing the probe means "we just lied about being on 0.73."

Concretely:

1. **Wrong dialect of "where is pi?"** — `readCurrentPiVersion()` in `packages/server/src/pi-version-skew.ts` uses `createRequire(import.meta.url).resolve("@mariozechner/pi-coding-agent/package.json")`. From `packages/server/.../pi-version-skew.ts` this only sees pi installed via npm-global / hoisted `node_modules`. A managed-only install at `~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent` is invisible. The dashboard's `ToolRegistry` *does* find it (managed strategy is in the chain), but the version probe doesn't go through the registry.

2. **Path arithmetic that breaks on Windows** — TRY 2 uses `dirname(dirname(realpath(res.path)))/package.json`. Works for Unix shim chains and managed installs, but fails for Windows `.cmd` shims because realpath doesn't follow `.cmd`. Result: on the most common Windows install path, version is `undefined` and the banner says "pi version: ?".

3. **60s cache not invalidated on rescan** — `runPostInstallRepair` calls `registry.rescan()` after `installing → ready`, but does not call `_resetVersionSkewCache()`. After a successful in-app pi upgrade, the banner can show the OLD version for up to 60 seconds — long enough that users click Upgrade twice and hit a 409 conflict.

4. **Dashboard doesn't notice out-of-band upgrades** — Three pi upgrade paths exist; only the UI banner upgrade triggers `runPostInstallRepair`. Terminal-driven `pi update --self` and `npm i -g @mariozechner/pi-coding-agent@latest` leave the registry resolution and version-skew cache stale until manual restart.

5. **Pi compatibility floor is two minor versions stale** — `packages/server/package.json::piCompatibility` pins `minimum: 0.70.0` and `recommended: 0.70.0`. Pi shipped 0.71/0.72/0.73 since then. The just-archived `replace-hardcoded-provider-lists` removes the previously biggest bump-blocker (drifted `OAUTH_PROVIDERS`/`API_KEY_PROVIDERS` arrays); defensive code in `provider-register.ts` accesses every pi internal via optional chaining + try/catch, so unrelated 0.71-0.73 internal API changes degrade to empty fields rather than crashes. Bumping the floor to 0.73.0 unlocks the visibility the catalogue already carries.

The five problems are causally linked: bumping the floor without fixing 1-3 produces a banner that says "0.73" but reads the version through broken plumbing; without 4, in-app upgrades disappear from the banner mid-session.

## What Changes

### Phase 1 — Probe via ToolRegistry (replaces fix-pi-version-probe-uses-registry)

- **MODIFY**: `packages/server/src/pi-version-skew.ts::readCurrentPiVersion(registry)` resolution chain:
  1. First, ask `registry.resolve("pi-coding-agent")` (module-kind tool, entry `dist/index.js`). If `ok && path`, the package directory is `dirname(dirname(path))` and `package.json` is at `<pkgDir>/package.json`. Read + parse, return version.
  2. Else `registry.resolve("pi")` (executor-kind). If `ok && path`:
     - If path ends with `.cmd` or `.bat` (Windows shim), return `undefined` rather than guessing — Windows `.cmd` shims do NOT sit at a fixed depth relative to `package.json`.
     - Otherwise realpath, walk dirname twice, read `package.json`.
  3. Else return `undefined`.
- **REMOVE**: the `createRequire(import.meta.url).resolve("...pi-coding-agent/package.json")` first attempt. The registry's `bare-import` strategy already covers that case as part of its chain.
- **MODIFY**: `packages/server/src/server.ts::runPostInstallRepair()` — call `_resetVersionSkewCache()` immediately after `registry.rescan()`. Both caches feed the banner; they share the bootstrap-state-ready signal and SHALL invalidate together.

### Phase 2 — Bridge pushes pi_version_update on activation + every 60s (replaces rescan-pi-after-self-update)

- **NEW protocol message**: `interface PiVersionUpdateMessage { type: "pi_version_update"; version: string }` added to the bridge→server union in `packages/shared/src/protocol.ts`.
- **MODIFY**: `packages/extension/src/bridge.ts` — at activation read `pi-coding-agent/package.json` via `createRequire` (the bridge runs INSIDE pi's tree, so resolution always works). Cache `lastPiVersion` at module scope. Send `pi_version_update` once at activation. Start a `setInterval(60_000)` that re-reads; only push on change. Clear interval on disconnect.
- **NEW server handler**: in `packages/server/src/event-wiring.ts`, on receipt of `pi_version_update`:
  1. Call `registry.rescan("pi")` and `registry.rescan("pi-coding-agent")` on the default registry.
  2. Call `_resetVersionSkewCache()`.
  3. Call `updateBootstrapCompatibility(...)` to recompute compatibility.
  4. Broadcast `bootstrap_status` to all browser subscribers.

### Phase 3 — Bump piCompatibility floor (replaces bump-pi-compatibility-073)

- **MODIFY**: `packages/server/package.json::piCompatibility`:
  - `minimum: "0.70.0"` → `"0.73.0"`
  - `recommended: "0.70.0"` → `"0.73.0"`
  - `maximum: null` (unchanged).

The bump SHALL come last in the implementation order — phases 1 and 2 give the user-visible banner correct, low-latency version data BEFORE the floor is lifted, so an upgrade hint surfaces accurately.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pi-core-version-check`:
  - `readCurrentPiVersion()` SHALL resolve via `ToolRegistry`; explicit `undefined` for Windows `.cmd` shims; cache invalidation paired with `registry.rescan()`.
  - Server SHALL invalidate registry + version-skew caches on `pi_version_update` and broadcast a fresh `bootstrap_status`.
  - `piCompatibility.minimum` and `recommended` pinned at `0.73.0`.
- `bridge-extension`: bridge SHALL push `pi_version_update` at activation and on detected version change (60s poll, debounced).

## Impact

**Files**:
- `packages/server/src/pi-version-skew.ts` — ~25 LOC net deletion (drop `createRequire` block, simplify chain).
- `packages/server/src/server.ts` — +1 line (cache reset call).
- `packages/server/src/event-wiring.ts` — ~15 LOC (new dispatcher arm).
- `packages/extension/src/bridge.ts` — ~25 LOC (poll + push).
- `packages/shared/src/protocol.ts` — +1 message type.
- `packages/server/package.json` — 2 string changes in `piCompatibility`.

**Tests**: ~5 new (registry-resolves-managed-only; Windows-cmd-returns-undefined; cache-invalidates-on-rescan; bridge-poll-pushes-on-change; server-handler-invalidates-and-broadcasts). Existing `pi-version-skew.test.ts` extended.

**Risk**: low. Phases 1+2 use data the rest of the dashboard already trusts. Phase 3 is 2 lines of JSON. Zero protocol breakage on browser side; the new bridge→server message is additive.

**Cross-references**:
- Builds on archived `replace-hardcoded-provider-lists` (catalogue path is what makes pi 0.73 catch-up safe). Without that change, bumping the floor would cascade through the dashboard's hardcoded provider lists.
- This proposal is the prerequisite for the sibling `adopt-pi-071-072-073-features` change, which assumes a working version probe + a 0.73 floor before it adopts new pi APIs.

## Out of Scope

- Adopting pi 0.71/0.72/0.73 user-visible features (`thinking_level_select` event, per-model thinking levels, graceful stop-after-turn, `message_end` content replacement, bash streaming, dead OAuth handler removal). Those land in `adopt-pi-071-072-073-features` after this change.
- Maximum-version pin in `piCompatibility`. Stays `null`; pi has no breaking-change semver discipline yet that would justify pinning a ceiling.
- Bridge-side resolution of pi via `ToolRegistry`. Bridge runs inside pi's process and already resolves pi via `createRequire(import.meta.url)` correctly; no change.
