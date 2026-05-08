## Context

The dashboard's `PiCoreChecker` (`packages/server/src/pi-core-checker.ts`) discovers installed pi packages and compares their versions against npm registry's `latest` dist-tag via `fetchPackageMeta` (which scrapes the registry). Pi itself does NOT use the npm registry for self-update checks — pi 0.70.6's CHANGELOG explicitly notes the switch to a dedicated endpoint:

> Pi update checks now use `pi.dev` and identify Pi with a `pi/<version>` user agent.

Pi's source is at `~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent/dist/utils/version-check.js`. The implementation is small and clean:

```js
GET https://pi.dev/api/latest-version
User-Agent: pi/0.70.6 (linux; node/v22.20.0; x64)
Accept: application/json
→ { version: "0.74.0", packageName: "@earendil-works/pi-coding-agent" }
```

The `packageName` field — present since 0.73.1 — exists specifically to handle the upcoming scope rename. Pi's `pi update --self` flow uses it to decide which package to install. The dashboard ignores both fields entirely today.

Meanwhile, the icon-on-row affordance shipped in `pi-update-whats-new-panel` has a discovery defect: users only see the "what's new" dialog if the range contains a `### Breaking Changes` section. Patch updates with rich `### Fixed` content (e.g. `0.70.5 → 0.70.6` brings 8 distinct fixes) are invisible. The data exists; the trigger is missing.

## Goals / Non-Goals

**Goals:**
- Detect the genuinely-newest pi version regardless of npm-registry lag.
- Handle pi's upcoming scope rename without hardcoding `@earendil-works/...` anywhere — the renamed package name flows through the pi.dev response.
- Surface the changelog dialog as a discovery affordance for ANY update, not only breakings, while keeping breaking changes visually distinct (amber vs neutral).

**Non-Goals:**
- Replacing npm registry lookup for non-pi core packages (`@blackbelt-technology/pi-agent-dashboard`, `@blackbelt-technology/pi-model-proxy`). Those have no pi.dev equivalent; npm registry stays.
- Using pi.dev for `@oh-my-pi/pi-coding-agent` (the fork). The fork's release cadence and self-update story are independent.
- Persisting pi.dev responses long-term. The 5-minute in-memory cache in `PiCoreChecker` is sufficient.
- Adding telemetry / install reporting back to pi.dev (pi's `report-install` endpoint). The dashboard isn't pi; we just need the version-check side.

## Decisions

### 1. Mirror pi's exact request shape

**Decision:** the new `pi-dev-version-check.ts` matches pi's own `version-check.js` byte-for-byte in argv shape and User-Agent format.

**Why:** pi.dev may eventually rate-limit or filter by User-Agent. Sending the same UA pi sends ensures we get treated identically. If pi.dev ever blacklists non-pi clients, we'd want a different UA — but until then, parity is the safe default.

The User-Agent uses the **dashboard's currently-resolved pi version** (i.e. what `PiCoreChecker.discoverManaged().version` returned). If pi isn't installed yet, the version-check call is skipped entirely (no point asking for an upgrade when there's nothing to upgrade from).

**Alternatives considered:**
- *Custom `pi-dashboard/<version>` UA.* More honest about caller identity, but invites pi.dev maintainers to filter or down-prioritize. Not worth the risk for v1.

### 2. pi.dev is the authority for `@mariozechner/pi-coding-agent`; npm registry is fallback

**Decision:** when `PiCoreChecker` checks pi-coding-agent, it calls pi.dev first. On any of:
- network failure
- non-2xx response
- response missing `version` field
- `PI_SKIP_VERSION_CHECK=1` set
- `PI_OFFLINE=1` set

…it falls through to the existing `fetchPackageMeta` npm registry path. Both paths populate the same `latestVersion` field on `PiCorePackage`.

**Why:** npm registry stays as a degraded mode so the dashboard never reports "unknown version" just because pi.dev had a hiccup. Users in air-gapped environments (`PI_OFFLINE=1`) keep the npm registry-driven flow they had before.

### 3. Honour the dynamic `packageName` response

**Decision:** when pi.dev's response includes a `packageName` field that differs from the queried package, the dashboard treats it as a trusted alias.

Concretely:
- `PiCoreChecker.discoverGlobal` and `discoverManaged` continue to gate on `CORE_PACKAGE_NAMES`, but ALSO accept any name returned by a recent pi.dev response.
- The `PiCorePackage.name` reported to the UI is the **installed** package name (could be either old or new scope), so the row's `[Update]` button targets the actual installed location.
- The "newer version" comparison uses pi.dev's `version` field. The "should rename" hint (when installed is `@mariozechner/...` but pi.dev returns `@earendil-works/...`) is a future concern — for v1 we treat scope mismatch as just "an update is available", which the existing flow handles.

**Why:** pi maintainers chose this design specifically to make consumers like us forward-compatible without code changes. Following their contract here means the dashboard automatically supports the rename whenever pi.dev starts returning the new scope, without us shipping a new release.

**Open question (deferred):** when pi.dev returns a different scope, should the dashboard's `[Update]` flow uninstall the old package after installing the new one (mirroring `pi update --self`)? Today, `npm install <new-pkg>@latest` adds the new scope alongside the old. Cleanup is a separate concern tracked later — for v1 the user has both packages installed, with the old one going stale.

### 4. Always-show icon with two visual states

**Decision:** `PackageRow` accepts a new prop `whatsNewKind?: "breaking" | "info" | undefined`. The render predicate widens from `breakingChangeCount > 0` to `whatsNewKind !== undefined`:

```
   undefined        → no icon
   "breaking"       → amber alert-circle-outline + "<N> breaking changes since your version" tooltip
   "info"           → muted neutral information-outline + "View what's new" tooltip
```

`UnifiedPackagesSection` derives `whatsNewKind` from the changelog response:
- `response.hasBreaking` → `"breaking"`
- `response.releases.length > 0 && !response.hasBreaking` → `"info"`
- `releases.length === 0 || !response` → `undefined` (icon hidden)

**Why:** the boolean `breakingChangeCount > 0` couldn't carry the second visual state. A discriminated string is ergonomic and lets future variants slot in (`"prerelease"`, `"downgrade"`, etc.) without breaking changes to the prop.

### 5. The dialog content doesn't change

**Decision:** `WhatsNewDialog` is unchanged. It already renders breaking, features, changed+fixed sections; only the breaking section is auto-expanded.

**Why:** the dialog was designed mode-agnostic — only the path to it changes. Less code churn, less test surface to update.

## Risks / Trade-offs

- **[Risk]** pi.dev maintainers change the response shape (e.g. drop `packageName`, rename `version`). → **Mitigation:** the parse is defensive (`typeof data.version === "string"` check); on schema mismatch we fall back to npm registry. A monitoring blip but not a hard failure.
- **[Risk]** pi.dev rate-limits dashboard fleet. → **Mitigation:** 5-minute in-memory cache in `PiCoreChecker` already prevents per-second flood; only one request per dashboard per cache window.
- **[Risk]** Always-show icon adds visual chrome on every Core row update. → **Acceptable.** The neutral icon is muted (text-muted color, not accent); it's information-bearing without being alarming. Less noisy than a banner.
- **[Trade-off]** Dynamic `packageName` acceptance widens the trust surface — any string pi.dev returns is now a "trusted alias". Network MITM is mitigated by HTTPS; the actual trust boundary is "do you trust pi.dev's TLS certificate", which is the same trust boundary pi itself relies on.
- **[Trade-off]** Two visual icon states can be confused (warning yellow vs muted info). Tooltips disambiguate; the visual difference (color + icon path) is large.

## Migration Plan

Pure additive code change. No data migration. No deprecations. Server restart picks up the new version-check path. Client picks up the icon predicate change after rebuild.

Rollback: revert the diff. Both files affected (`pi-core-checker.ts`, `PackageRow.tsx`, `UnifiedPackagesSection.tsx`) are localized; no protocol or persistence changes to undo.
