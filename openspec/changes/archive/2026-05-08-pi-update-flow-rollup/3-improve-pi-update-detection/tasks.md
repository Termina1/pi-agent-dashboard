## 1. pi.dev version-check module

- [x] 1.1 Create `packages/server/src/pi-dev-version-check.ts` with: `getPiUserAgent(version, runtime?)`, `parsePackageVersion()`, `comparePackageVersions()`, `isNewerPackageVersion()`, `getLatestPiRelease(currentVersion, opts?)`. Mirror `~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent/dist/utils/version-check.js` byte-for-byte in argv shape and User-Agent format.
- [x] 1.2 Honour `PI_SKIP_VERSION_CHECK` and `PI_OFFLINE` envs — when either is set, `getLatestPiRelease()` returns `undefined` immediately without issuing any request.
- [x] 1.3 10-second timeout via `AbortSignal.timeout(10000)` on the fetch.
- [x] 1.4 Response shape: `{ version: string, packageName?: string }`. Parse defensively; on missing/empty `version` return `undefined`. Trim string fields.
- [x] 1.5 Add `packages/server/src/__tests__/pi-dev-version-check.test.ts` covering: successful fetch, network error → undefined, non-2xx → undefined, malformed JSON → undefined, missing version field → undefined, PI_OFFLINE skip, PI_SKIP_VERSION_CHECK skip, User-Agent format, packageName preserved, timeout enforced.

## 2. PiCoreChecker integration

- [x] 2.1 In `packages/server/src/pi-core-checker.ts`, modify the version-comparison logic so that for `@mariozechner/pi-coding-agent` (and any name from the dynamic-alias set per task 2.3), the checker calls `getLatestPiRelease(currentVersion)` first.
- [x] 2.2 On any failure of the pi.dev path (including envs forcing skip), fall back to the existing `fetchPackageMeta` npm registry path. Both paths populate `latestVersion` identically.
- [x] 2.3 Track the most-recently-returned `packageName` from pi.dev in module-level state. Extend `looksLikePiEcosystem(name)` (or add a new accepting-aliases predicate) to include any pi.dev-returned `packageName`. The static `CORE_PACKAGE_NAMES` whitelist is unchanged; aliases are additive.
- [x] 2.4 Document the dynamic-alias contract in a comment at the top of the file: "pi.dev's `packageName` response field is treated as a trusted alias for `@mariozechner/pi-coding-agent`. This handles pi's scope migration without requiring the dashboard to ship a release every time the canonical scope changes."
- [x] 2.5 Add tests in `packages/server/src/__tests__/pi-core-checker.test.ts` covering: pi.dev path succeeds → `latestVersion` from pi.dev, pi.dev path fails → falls back to npm registry, pi.dev returns alias `packageName` → discovery accepts the new name, non-pi packages bypass pi.dev entirely.

## 3. UI: always-show icon with two states

- [x] 3.1 In `packages/client/src/components/PackageRow.tsx`, replace the existing `breakingChangeCount?: number` prop with `whatsNewKind?: "breaking" | "info" | undefined` (keep `breakingChangeCount` for tooltip count). Update the icon-render predicate to `whatsNewKind !== undefined && onShowWhatsNew !== undefined`.
- [x] 3.2 Render `mdiAlertCircleOutline` in amber (`text-amber-400`) for `whatsNewKind === "breaking"`. Render `mdiInformationOutline` in `text-[var(--text-muted)]` for `whatsNewKind === "info"`. Same click handler in both states.
- [x] 3.3 Tooltip text branches: breaking → "<N> breaking change(s) since your version". info → "View what's new". `aria-label` mirrors tooltip.
- [x] 3.4 Update `packages/client/src/components/__tests__/PackageRow.whats-new.test.tsx`: existing "icon visible when count > 0" test remains; add new tests for the info state; add a test for `whatsNewKind: undefined` hides icon.

## 4. UnifiedPackagesSection wiring

- [x] 4.1 In `packages/client/src/components/UnifiedPackagesSection.tsx`, derive `whatsNewKind` from the changelog response: `response?.hasBreaking ? "breaking" : (response?.releases.length ?? 0) > 0 ? "info" : undefined`.
- [x] 4.2 Pass `whatsNewKind` and `breakingChangeCount` (already computed) to the pi row. Wire `onShowWhatsNew` whenever `whatsNewKind !== undefined`.
- [x] 4.3 Verify the changelog fetch still fires only when `updateAvailable` AND for the pi row only (no widening of fetch scope to non-pi rows).

## 5. Auto-check installed-package updates

- [x] 5.1 In `UnifiedPackagesSection.tsx`, add a `useEffect` that fires `handleCheckUpdates()` once on mount AFTER the initial installed-packages list resolves (gate on `installed.packages.length > 0` OR `!installed.isLoading`).
- [x] 5.2 Add a 30-minute interval (matching `usePiCoreVersions.POLL_INTERVAL_MS`) that re-fires `handleCheckUpdates()` while mounted. Clear the interval on unmount.
- [x] 5.3 Add a `pi-package-event` WS listener (the existing event bus already broadcasts `package_operation_complete` via `useMessageHandler`) that re-fires `handleCheckUpdates()` whenever `success === true`. De-duplicate against any in-flight check.
- [x] 5.4 Reset the poll timer when the user clicks `[Check Now]` so two checks don't fire seconds apart.
- [x] 5.5 On auto-check failure, swallow the error silently (no inline display) but ensure the next poll still fires.
- [x] 5.6 Add component test in `packages/client/src/components/__tests__/UnifiedPackagesSection.auto-check.test.tsx`: assert `fetch('/api/packages/check-updates')` fires once on mount after installed list loads; fires on `pi-package-event` WS event with success; does NOT fire while installed list is still loading.

## 6. Verify

- [x] 6.1 Run targeted tests: `HOME=$(mktemp -d) npx vitest run packages/server/src/__tests__/pi-dev-version-check.test.ts packages/server/src/__tests__/pi-core-checker.test.ts packages/client/src/components/__tests__/PackageRow.whats-new.test.tsx packages/client/src/components/__tests__/UnifiedPackagesSection.auto-check.test.tsx` — all green.
- [x] 6.2 Run `npm run lint` — no new TypeScript errors introduced.
- [x] 6.3 Run `npm run build` — client compiles.
- [ ] 6.4 Manual smoke test: with pi 0.70.6 installed AND `@tintinweb/pi-subagents` having an available update, verify (a) the pi row shows "0.70.6 → 0.74.0" (pi.dev's latest, NOT npm's), (b) the info icon renders for non-breaking patch updates and amber for breaking ones, (c) the Recommended Extensions group's `@tintinweb/pi-subagents` row shows an Update button without anyone clicking [Check Now]. (Deferred to user — requires running dashboard.)
