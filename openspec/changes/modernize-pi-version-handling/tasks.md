## 1. Phase 1 — Rewrite the probe via ToolRegistry

- [ ] 1.1 In `packages/server/src/pi-version-skew.ts::readCurrentPiVersion(registry)`, delete the `createRequire` block (today's TRY 1).
- [ ] 1.2 Replace function body with the new chain (per design.md §"The version probe"): registry-module-first, then registry-executor-with-Windows-bail, then `undefined`.
- [ ] 1.3 Drop unused `createRequire` import.
- [ ] 1.4 Update inline doc comment to reflect the new resolution chain.
- [ ] 1.5 Tests in `packages/server/src/__tests__/pi-version-skew.test.ts`:
  - [ ] 1.5.1 Managed-only install: `registry.resolve("pi-coding-agent")` returns `{ ok: true, path: "/managed/.pi-dashboard/.../pi-coding-agent/dist/index.js" }`. Stub `fs.readFileSync` to return `{"version":"0.73.1"}`. Assert returns `"0.73.1"`.
  - [ ] 1.5.2 Windows `.cmd` shim only: `registry.resolve("pi-coding-agent")` fails, `registry.resolve("pi")` returns a `.cmd` path. Assert returns `undefined`.
  - [ ] 1.5.3 Unix npm-bin chain (regression): `registry.resolve("pi")` returns `/usr/local/bin/pi` symlink, realpath resolves to `.../pi-coding-agent/dist/cli.js`. Assert reads `.../pi-coding-agent/package.json`.

## 2. Phase 1 — Cache invalidation pairing

- [ ] 2.1 Extract a helper `refreshPiCompatibilityState({ registry, bootstrapState, broadcast })` that performs the four-step recipe (rescan pi, rescan pi-coding-agent, reset version-skew cache, updateBootstrapCompatibility, broadcast bootstrap_status). Place in `packages/server/src/pi-version-skew.ts` or `event-wiring.ts` — wherever the existing helpers live.
- [ ] 2.2 In `packages/server/src/server.ts::runPostInstallRepair()`, replace the standalone `registry.rescan()` call with `await refreshPiCompatibilityState(deps)`. Verify imports.
- [ ] 2.3 Update doc-comment block above `runPostInstallRepair` to mention the cache flush.
- [ ] 2.4 Test in `packages/server/src/__tests__/server.test.ts` (or post-install-repair test): assert `_resetVersionSkewCache` called after `registry.rescan` by stubbing both and recording call order.

## 3. Phase 2 — Protocol message

- [ ] 3.1 In `packages/shared/src/protocol.ts`, add `interface PiVersionUpdateMessage { type: "pi_version_update"; version: string }`. Add to `ExtensionToServerMessage` union.
- [ ] 3.2 Add round-trip JSON test in `packages/shared/src/__tests__/protocol.test.ts`.

## 4. Phase 2 — Bridge poll + push

- [ ] 4.1 In `packages/extension/src/bridge.ts`, add module-scope cached `lastPiVersion: string | undefined` and a helper `readPiVersionFromBridge()` reading `pi-coding-agent/package.json` via `createRequire(import.meta.url).resolve(...)` + `fs.readFileSync`.
- [ ] 4.2 Hook activation: at the existing `session_register` flow (where catalogue is pushed), call `maybePushVersion()` once. Idempotent if already pushed.
- [ ] 4.3 Start `setInterval(60_000)` after activation. On each tick re-read; only push when value changes.
- [ ] 4.4 Clear interval on disconnect / deactivation. `lastPiVersion` retained so re-activation skips a no-op push.
- [ ] 4.5 Failure-mode: if read throws, log warning + skip push. Timer continues.
- [ ] 4.6 Tests in `packages/extension/src/__tests__/bridge-pi-version-poll.test.ts`:
  - [ ] 4.6.1 Inject fake `setInterval` + fake reader returning sequence of versions. Assert: first activation pushes once; same-value poll pushes nothing; changed-value poll pushes once.
  - [ ] 4.6.2 Reader throws → assert no crash, no push, timer still scheduled for next tick.

## 5. Phase 2 — Server handler

- [ ] 5.1 In `packages/server/src/event-wiring.ts`, add a `pi_version_update` arm to the bridge-message dispatcher. Calls the `refreshPiCompatibilityState` helper.
- [ ] 5.2 Wire imports for the helper.
- [ ] 5.3 Test in `packages/server/src/__tests__/event-wiring-pi-version-update.test.ts`:
  - Inject fake registry + fake `_resetVersionSkewCache` + fake `updateBootstrapCompatibility` + fake browser broadcaster. Send `pi_version_update`, assert all four are called in correct order. Broadcast carries `bootstrap_status` with the new compatibility.

## 6. Phase 3 — Bump piCompatibility floor

- [ ] 6.1 Pre-bump verification: install pi 0.73.x locally (`npm i -g @mariozechner/pi-coding-agent@^0.73.0` or via `pi update --self`).
- [ ] 6.2 Spawn a dashboard session against pi 0.73. Open `Settings → Provider Authentication`. Confirm catalogue still arrives (catalogue path unchanged).
- [ ] 6.3 Confirm the new providers (cloudflare-ai-gateway, cloudflare-workers-ai, moonshotai, deepseek, mistral) appear; confirm gemini-cli + antigravity are absent.
- [ ] 6.4 Verify `~/.pi/dashboard/server.log` shows zero new errors from `provider-register.ts` or `bridge.ts`.
- [ ] 6.5 In `packages/server/package.json`:
  - [ ] 6.5.1 `piCompatibility.minimum`: `"0.70.0"` → `"0.73.0"`.
  - [ ] 6.5.2 `piCompatibility.recommended`: `"0.70.0"` → `"0.73.0"`.
  - [ ] 6.5.3 Leave `piCompatibility.maximum` as `null`.

## 7. Verification

- [ ] 7.1 `npm test` passes.
- [ ] 7.2 `npm run build && curl -X POST http://localhost:8000/api/restart`.
- [ ] 7.3 With pi 0.73 installed: `GET /api/bootstrap/status` returns `compatibility.current === "0.73.x"` and `upgradeRecommended` is undefined / false.
- [ ] 7.4 With pi 0.70 installed (or simulated): `upgradeRecommended: true` appears.
- [ ] 7.5 With managed-only install (delete `~/.nvm/.../@mariozechner/pi-coding-agent` if present, run wizard install): banner correctly reports the managed pi version.
- [ ] 7.6 Out-of-band upgrade smoke: with dashboard running and pi at 0.72, run `pi update --self` from a separate terminal. Within 60s, `GET /api/bootstrap/status` reflects the new version. UI banner refreshes without page reload.
- [ ] 7.7 In-app upgrade: flip bootstrap state via UI. Confirm banner updates immediately (no 60s lag).

## 8. Documentation

- [ ] 8.1 CHANGELOG `[Unreleased] / ### Fixed`: "Bootstrap banner now reads the installed pi version through the same `ToolRegistry` chain that drives Settings → Tools, so managed-only installs and Windows `.cmd` shims report the correct version (or explicitly nothing) instead of falling back to stale or empty data. The 60-second version-skew cache is invalidated on every registry rescan, so in-app upgrades reflect immediately."
- [ ] 8.2 CHANGELOG `[Unreleased] / ### Added`: "Dashboard now detects out-of-band pi upgrades (`pi update --self` or `npm i -g …` from the terminal). The bridge polls its own pi version every 60 seconds and pushes `pi_version_update` to the server, which invalidates registry caches and refreshes the bootstrap banner."
- [ ] 8.3 CHANGELOG `[Unreleased] / ### Changed`: "Pinned pi compatibility floor to `0.73.0`. Bridge's defensive catalogue introspection means no breaking surface; users on older pi see an upgrade banner."
- [ ] 8.4 Update `docs/file-index-server.md` rows for `pi-version-skew.ts` and `event-wiring.ts` (caveman style).
- [ ] 8.5 Update `docs/file-index-extension.md` row for `bridge.ts` (poll + push).
- [ ] 8.6 Update `docs/file-index-shared.md` for `protocol.ts` (new message type).

## 9. Archive readiness

- [ ] 9.1 `openspec validate modernize-pi-version-handling` passes.
- [ ] 9.2 Hand off for archival via `openspec-archive-change` once 1-8 are green.
