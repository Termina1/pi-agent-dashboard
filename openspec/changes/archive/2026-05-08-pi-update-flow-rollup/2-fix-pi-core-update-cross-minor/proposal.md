## Why

The `[Update]` button in Settings → Pi Ecosystem → Core silently no-ops when the user's installed pi version is in a different minor than the latest npm release. The dashboard surfaces "0.70.6 → 0.73.1 [Update]" — but clicking does nothing, no error, no progress, no version change.

Root cause: `pi-core-updater.ts` runs `npm update <pkg>` (managed) or `npm update -g <pkg>` (global). `npm update` honours the existing dependency range in the consuming `package.json`. The managed install's `~/.pi-dashboard/package.json` ships pi pinned at `^0.70.0`, which the caret operator restricts to `0.70.x`. Pi already published `0.73.1`, far above that ceiling. `npm update` therefore considers the package up to date and exits 0 without doing anything.

This is not a hypothetical: pi has shipped breaking changes at minor boundaries (0.71, 0.72, 0.73 each carry `### Breaking Changes` sections) so cross-minor updates are now a routine, expected user action. The just-shipped `pi-update-whats-new-panel` change actively encourages users to click `[Update]` after reading the breaking-change panel — and the click does nothing. The bug is now in the user's face.

The companion `POST /api/bootstrap/upgrade-pi` endpoint already sidesteps this issue by running `npm install <pkg>` (no version pin), which always fetches the npm `latest` dist-tag regardless of the consuming `package.json` range.

## What Changes

- Replace `npm update <pkg>` with `npm install <pkg>@latest` in `defaultRunNpmUpdate` (`pi-core-updater.ts`) for both `installSource: "managed"` and `installSource: "global"` paths. **BREAKING** for callers depending on the literal argv shape — only the existing test suite is affected.
- Update existing tests in `pi-core-updater-managed-path.test.ts` that pin the literal argv `["update", ...]` to expect the new `["install", "<pkg>@latest", ...]` form.
- Add a new test asserting that the spawned argv targets `<pkg>@latest` (not just `<pkg>`) so the regression cannot return.
- Update the EACCES permission-hint message that today references `sudo npm update -g <pkg>` to reference `sudo npm install -g <pkg>@latest` instead — the suggested remediation should match the command we actually run.
- Update the docstring on `pi-core-updater.ts` to say "install latest" rather than "update".

Scope-limiting decisions:
- No changes to `bootstrapInstall` (already correct).
- No changes to `PiCoreChecker` (correctly reports current vs registry-latest already).
- No changes to the `/api/pi-core/update` endpoint contract or request/response shape.
- No changes to the `/reload` broadcast logic on success.
- No changes to caller code in `pi-changelog-routes.ts`, `UnifiedPackagesSection.tsx`, etc.
- No new endpoint. No new UI.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pi-core-version-check`: the existing scenarios "Update global package" and "Update managed package" change their expected npm verb. The new scenario "Update crosses minor-version boundary" pins the cross-minor behaviour the original `npm update` semantics broke.

## Impact

**Touched code (~8 LOC):**
- `packages/server/src/pi-core-updater.ts` — change argv from `["update", ...]` to `["install", "<pkg>@latest", ...]`; update permission-hint string; update file-level docstring.

**Touched tests (~30 LOC):**
- `packages/server/src/__tests__/pi-core-updater-managed-path.test.ts` — update argv-shape assertions.
- `packages/server/src/__tests__/pi-core-updater.test.ts` — update args assertion in "passes install-source-aware args & cwd to runNpmUpdate" test.

**New test (~25 LOC):**
- One scenario asserting that `npm install <pkg>@latest` is the spawned argv (anchoring the "@latest" suffix as the regression guard).

**Untouched:**
- All client code.
- All non-updater server code.
- The bootstrap install pipeline.
- The `pi-changelog-display` capability shipped by `pi-update-whats-new-panel`.

**Risk surface:**
- `npm install <pkg>@latest` rewrites the consuming `package.json` range on success (e.g. `^0.70.0` → `^0.73.1`). This is the desired outcome — without that rewrite, the next `npm update` cycle would once again be range-pinned. Both managed and global installs survive this rewrite cleanly because pi has no transitive peer-dep constraints on its consumers.
- A pinned-version use case (user explicitly wants to stay on `0.70.6`) is **not** supported today and is out of scope for this fix. Pinning is tracked separately in the proposed `pi-version-picker` discussion thread.
