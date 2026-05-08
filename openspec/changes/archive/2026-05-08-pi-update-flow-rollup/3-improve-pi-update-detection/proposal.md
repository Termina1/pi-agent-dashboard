## Why

Three related defects in how the dashboard surfaces pi updates:

**(1) Latest-version detection is wrong for pi.** `PiCoreChecker` queries the npm registry's `latest` dist-tag for every core package, including `@mariozechner/pi-coding-agent`. This misses two things pi already publishes via its own version-check endpoint at `https://pi.dev/api/latest-version`:

- The actual newest version (npm registry's `latest` dist-tag can lag pi.dev's source-of-truth, and pi.dev factors in pi's release cadence including post-publish corrections).
- The currently-active **package name** — pi 0.73.1 added support for the upcoming scope rename from `@mariozechner/pi-coding-agent` to `@earendil-works/pi-coding-agent`. The pi.dev response includes a `packageName` field; pi's own self-update flow uses it to pick the correct package to install. The dashboard does not, so once pi publishes under the new scope, our `[Update]` button will fail in confusing ways even after `fix-pi-core-update-cross-minor` lands. The user observed the symptom now: the row says "0.70.6 → 0.73.1" but pi has actually shipped 0.74.0 (the gap will widen).

**(2) Extension updates are silently ignored unless the user clicks `[Check Now]`.** Pi's interactive TUI calls `packageManager.checkForAvailableUpdates()` automatically on every startup; the dashboard's `/api/packages/check-updates` only fires when the user clicks the button in Settings. Result: the user opens pi in a session, sees pi's notification "Package Updates Available — `@tintinweb/pi-subagents`", looks at the dashboard's Settings → Pi Ecosystem panel, and sees nothing. The data is one HTTP call away but the dashboard never makes it. This applies to every package in `settings.json` (recommended extensions + other packages), not just pi-core.

**(3) The breaking-change icon is too narrow a discovery affordance.** It only renders when there are explicit `### Breaking Changes` sections in the range. Users with safer patch updates have no way to see what's coming until they click `[Update]` and find out. The data is already on the server (the parser populates `features`, `changed`, `fixed` regardless), and the dialog already renders all three sections — but users can't reach the dialog at all without a breaking change.

Fixing both in one change because they share the same UI surface (the icon on the pi row) and amplify each other: an accurate "latest" + a discoverable trigger together produce a usable update flow.

## What Changes

- Auto-fire `/api/packages/check-updates` on mount of `UnifiedPackagesSection` (debounced behind initial installed-list load) AND every 30 minutes thereafter, mirroring the polling cadence of `usePiCoreVersions`. Re-fire after every successful package operation (install / update / remove) so cleared-out updates disappear and freshly-needed ones appear without user intervention.
- Add `packages/server/src/pi-dev-version-check.ts` mirroring pi's own `version-check.js` implementation: `GET https://pi.dev/api/latest-version` with `User-Agent: pi/<version> (<platform>; <runtime>; <arch>)`, 10s timeout, returns `{ version, packageName? }`. Honours `PI_SKIP_VERSION_CHECK` and `PI_OFFLINE` envs identically to pi.
- Modify `PiCoreChecker` to call `pi-dev-version-check` for `@mariozechner/pi-coding-agent` (and any name pi.dev's response declares as the successor `packageName`). Fall back to npm registry on pi.dev failure / offline. Other core packages (`@blackbelt-technology/pi-agent-dashboard`, `@blackbelt-technology/pi-model-proxy`) continue using the npm registry path.
- When pi.dev returns a `packageName` that differs from the queried name, treat it as the new authoritative package. Surface this so the eventual `[Update]` flow can install the renamed package without the dashboard hardcoding `@earendil-works/...` anywhere — the renamed package name flows through dynamically.
- **BREAKING (UI behaviour):** modify the icon-on-row predicate from "render when breaking changes exist" to "render whenever a changelog is available between current and latest" — i.e. effectively any time `updateAvailable === true` and the parser produced ≥1 release entry. Two visual states:
  - **Amber + alert-circle-outline** when ≥1 breaking change in range (existing visual)
  - **Neutral muted + information-outline** when no breaking change but the changelog has releases to read
- Update the icon's tooltip to reflect content: "<N> breaking change(s) since your version" when amber, "View what's new" when neutral.
- Update the dialog title — already says "What's new in <pkg>" which works for both modes.

Scope-limiting decisions:
- No changes to `CORE_PACKAGE_NAMES`. The renamed package flows through the pi.dev response; the whitelist accepts whatever the canonical pi name is dynamically. (One follow-up note: when pi.dev starts returning `packageName: "@earendil-works/pi-coding-agent"`, that name will need to appear in the whitelist for `PiCoreChecker.discoverManaged()` to find a freshly-installed copy under the new scope. We make `CORE_PACKAGE_NAMES` extensible at runtime via the pi.dev response — any name returned is implicitly trusted.)
- No new endpoint. No new client API.
- No changes to the bootstrap flow.
- The 5-minute cache in `PiCoreChecker` is unchanged. pi.dev is queried on cache miss only.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pi-core-version-check`: version comparison for `@mariozechner/pi-coding-agent` (and its scope-rename successor) switches from npm-registry-only to pi.dev-first with npm-registry fallback. Adds support for dynamic package-name resolution from the pi.dev response.
- `pi-changelog-display`: the `WhatsNewDialog` is now opened for any non-empty changelog, not only changelogs containing breaking changes. The dialog content rules are unchanged.
- `pi-core-version-ui`: the breaking-change icon predicate widens from `breakingChangeCount > 0` to "changelog is available". Visual styling differentiates the two cases. Also gains an auto-check-on-mount + 30-minute poll for installed packages, so extension updates surface without manual `[Check Now]` clicks.

## Impact

**New code (~120 LOC + ~80 LOC tests):**
- `packages/server/src/pi-dev-version-check.ts` — pure module: `getPiUserAgent()`, `parsePackageVersion()`, `comparePackageVersions()`, `isNewerPackageVersion()`, `getLatestPiRelease()`. Honours skip-envs.
- `packages/server/src/__tests__/pi-dev-version-check.test.ts`

**Touched code (~70 LOC + ~50 LOC tests):**
- `packages/server/src/pi-core-checker.ts` — wire pi.dev for `pi-coding-agent`, accept dynamic `packageName`.
- `packages/server/src/__tests__/pi-core-checker.test.ts` — verify pi.dev path + fallback.
- `packages/client/src/components/PackageRow.tsx` — icon predicate + visual state.
- `packages/client/src/components/__tests__/PackageRow.whats-new.test.tsx` — additional test for neutral-state rendering.
- `packages/client/src/components/UnifiedPackagesSection.tsx` — pass icon-state prop to PackageRow; auto-fire `/api/packages/check-updates` on mount + 30-minute poll + post-operation re-fire.

**Untouched:**
- `pi-update-whats-new-panel`'s parser, route, dialog, and hook.
- `fix-pi-core-update-cross-minor`'s updater fix.
- Bootstrap state machine, `/reload` broadcast, install pipeline.

**Risk surface:**
- pi.dev unreachable (firewall / outage) → fall back to npm registry. Worst case: behaviour identical to today.
- pi.dev returns a `packageName` not in `CORE_PACKAGE_NAMES` (e.g. `@earendil-works/...` when whitelist still says `@mariozechner/...`). The dashboard currently uses the whitelist as an *output filter* on `discoverManaged`/`discoverGlobal`. We extend the discovery to also accept any `packageName` returned by pi.dev as a trusted alias for `@mariozechner/pi-coding-agent`. No security risk — pi.dev is HTTPS-pinned and a controlled endpoint.
- `PI_OFFLINE=1` users: pi.dev is silently skipped, npm registry still queried. Existing behaviour preserved for them.
