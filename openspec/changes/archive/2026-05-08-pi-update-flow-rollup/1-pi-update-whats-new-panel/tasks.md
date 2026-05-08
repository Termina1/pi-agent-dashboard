## 1. Shared types

- [x] 1.1 Create `packages/shared/src/changelog-types.ts` with `ChangelogBullet`, `ChangelogRelease`, and `ChangelogResponse` interfaces matching the Decisions §3 shape; include JSDoc on every field.
- [x] 1.2 Re-export the new types from `packages/shared/src/index.ts` (or the appropriate barrel) so server and client can import them.
- [x] 1.3 Add a unit test asserting the types compile against representative shapes (no runtime assertions; type-only).

## 2. Server-side parser

- [x] 2.1 Create `packages/server/src/changelog-parser.ts` exporting a pure function `parseChangelog(markdown: string): ChangelogRelease[]`.
- [x] 2.2 Implement H2 release-header detection (`/^## \[(.+?)\] - (.+?)$/m`) and `(version, date)` extraction; tolerate missing/malformed dates by returning `null`.
- [x] 2.3 Implement H3 sub-section splitting per release; map `### Breaking Changes`, `### New Features`, `### Added`, `### Changed`, `### Fixed` to the corresponding typed arrays. Merge `New Features + Added` into `features`.
- [x] 2.4 Extract per-bullet issue links via `/\(\[#(\d+)\]\((https?:\/\/[^)]+)\)\)/g`; preserve the original prose unchanged.
- [x] 2.5 Populate `raw` with the full H2-section text per release.
- [x] 2.6 Add unit tests in `packages/server/src/__tests__/changelog-parser.test.ts` covering: typed sections extracted, multiple releases ordered latest-first, malformed input returns empty list, unrecognized H3 tolerated, issue link extraction, raw section retention, real fixture from `~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent/CHANGELOG.md` slice (committed as fixture file).

## 3. Server-side filesystem + version helpers

- [x] 3.1 Create `packages/server/src/changelog-fs.ts` with `findChangelogPath(pkg: string): string | null` that searches: managed install (`~/.pi-dashboard/node_modules/<pkg>/CHANGELOG.md`), then npm-global path resolved via `ToolRegistry.resolveModule(pkg)`, then `bare-import` resolution.
- [x] 3.2 Add `readPackageJson(pkg: string): unknown | null` helper returning the parsed `package.json` next to the discovered CHANGELOG (used for `repository` + `version` extraction).
- [x] 3.3 Add `deriveChangelogUrl(repository: unknown): string | null` implementing the rules in `pi-changelog-display#Requirement: Changelog URL derivation` (string forms, object form, `directory` subfield).
- [x] 3.4 Add unit tests covering: managed-only install, global-only install, both present (managed wins), missing CHANGELOG returns null, `repository` parsing for all three documented forms, monorepo `directory` honored, non-GitHub repository returns null.

## 4. Server-side cache

- [x] 4.1 In `changelog-parser.ts`, add a memoization layer keyed by `(pkg, mtimeMs)` with 60-second TTL. Cache `ChangelogRelease[]` (parser output), not the filtered response.
- [x] 4.2 Export `_resetChangelogCache()` test helper.
- [x] 4.3 Hook cache invalidation into `PiCoreChecker.invalidate()` — whenever `invalidate()` is called, clear the changelog cache for that package as well.
- [x] 4.4 Add unit tests asserting: cache hit within TTL, cache miss after mtime change, cache miss after `_resetChangelogCache()`, cache cleared by `PiCoreChecker.invalidate()`.

## 5. Server REST route

- [x] 5.1 Create `packages/server/src/routes/pi-changelog-routes.ts` registering `GET /api/pi-core/changelog`.
- [x] 5.2 Validate `pkg` query param against `CORE_PACKAGE_NAMES` (from `pi-core-checker.ts`); return 400 on miss.
- [x] 5.3 Validate `from` and `to` query params using the existing `parseVersion` helper from `pi-version-skew.ts`; return 400 on parse failure.
- [x] 5.4 Apply the existing `bootstrapGate` `preHandler` so the route returns 503 when `bootstrapState.status !== "ready"`.
- [x] 5.5 Read CHANGELOG via `changelog-fs`, parse, filter releases to `(from, to]`, derive `hasBreaking`, derive `changelogUrl`, return `ChangelogResponse`.
- [x] 5.6 When CHANGELOG cannot be located but the package IS in the whitelist: return 200 with `{ releases: [], hasBreaking: false, changelogUrl: null }`.
- [x] 5.7 Register route in `packages/server/src/server.ts` next to existing `registerPiCoreRoutes`.
- [x] 5.8 Add Fastify integration tests in `packages/server/src/__tests__/pi-changelog-routes.test.ts` covering every scenario in `pi-changelog-display#Requirement: Changelog REST endpoint`.

## 6. Client API helper + hook

- [x] 6.1 Add `fetchPiChangelog(pkg, from, to): Promise<ChangelogResponse>` to `packages/client/src/lib/pi-core-api.ts` (or create the file if absent).
- [x] 6.2 Create `packages/client/src/hooks/usePiChangelog.ts` — fetches lazily (only when `enabled` arg is true), keys cache by `(pkg, from, to)`, exposes `{ data, loading, error }`, refetches when `package_operation_complete` is received for the same pkg via the existing browser-WS event bus.
- [x] 6.3 Add unit tests for the hook: fires on mount when enabled, no fire when disabled, refetches on relevant WS event, no duplicate fetch for same key, surfaces error without throwing.

## 7. WhatsNewDialog component

- [x] 7.1 Create `packages/client/src/components/WhatsNewDialog.tsx` using the existing `DialogPortal` pattern; props `{ open, response, onClose, onUpdate, latestVersion }`.
- [x] 7.2 Render dialog title `"What's new in <pkg friendly name> (<from> → <to>)"`.
- [x] 7.3 Render Breaking Changes section (always expanded) listing every breaking bullet across releases, grouped by version with version + date sub-headers.
- [x] 7.4 Render bullet prose via `MarkdownContent` so issue/PR links resolve as clickable anchors with `target="_blank"`.
- [x] 7.5 Render "New features" section (collapsed by default) merging `features` arrays across releases; render "Other changes" section (collapsed by default) merging `changed + fixed`.
- [x] 7.6 Render footer link "Open full changelog on GitHub" using `response.changelogUrl` when non-null.
- [x] 7.7 Render footer CTAs: `[Cancel]` (closes) and `[Update to <latest>]` (closes + invokes `onUpdate`).
- [x] 7.8 Render empty-state message when `releases.length === 0`.
- [x] 7.9 Add component tests covering: open/close, breaking pinned at top, expand toggles work, link sanitization respected, Update CTA invokes onUpdate, empty-state fallback.

## 8. PackageRow icon affordance

- [x] 8.1 Add optional props to `packages/client/src/components/PackageRow.tsx`: `breakingChangeCount?: number` and `onShowWhatsNew?: () => void`.
- [x] 8.2 Render `mdiAlertCircleOutline` between the version arrow and the `[Update]` button when `breakingChangeCount && breakingChangeCount > 0 && onShowWhatsNew`.
- [x] 8.3 Wire icon click to `onShowWhatsNew`; set `aria-label="Breaking changes since your version — click for details"`; add native `title` attribute with "<N> breaking changes since your version".
- [x] 8.4 Ensure no visual regression when both new props are absent: row layout matches today's snapshot.
- [x] 8.5 Add component tests covering: icon hidden when count is 0/undefined, icon visible when count > 0, click invokes handler, tooltip text renders correctly.

## 9. UnifiedPackagesSection wiring

- [x] 9.1 In `packages/client/src/components/UnifiedPackagesSection.tsx`, find the pi row in `corePackages` (name === `@mariozechner/pi-coding-agent`).
- [x] 9.2 Call `usePiChangelog(piPkg.name, piPkg.currentVersion, piPkg.latestVersion, { enabled: piPkg.updateAvailable && piPkg.name === "@mariozechner/pi-coding-agent" })`.
- [x] 9.3 Pass derived `breakingChangeCount` (sum of breaking bullets across releases) and `onShowWhatsNew` (opens local dialog state) to the pi row's `PackageRow`. Do NOT pass these props for any other Core row.
- [x] 9.4 Render `<WhatsNewDialog>` at the section root, controlled by local state, with `onUpdate` wired to `doCoreUpdate([piPkg.name])`.
- [x] 9.5 Verify no changelog fetch is issued for non-pi Core rows or when pi has no update available.

## 10. Tests + documentation

- [x] 10.1 Add an integration test that boots the server with a fixture managed install and exercises the full flow: `GET /api/pi-core/changelog` → response shape matches spec → cache hit on second request → invalidation after `PiCoreChecker.invalidate()`.
- [x] 10.2 Add the new route + parser to `docs/file-index-server.md` with one-line caveman-style entries; delegate the doc edit to a general-purpose subagent per AGENTS.md "Documentation Update Protocol".
- [x] 10.3 Add the dialog + hook to `docs/file-index-client.md` similarly.
- [x] 10.4 Update `AGENTS.md` "Key Files" only if any of the new files are architectural backbone; otherwise skip per the same protocol. (Skipped — feature-scoped, not architectural backbone.)
- [x] 10.5 Run `npm test 2>&1 | tee /tmp/pi-test.log` and `grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log` to confirm zero regressions. (4737 passed, 3 pre-existing failures in `resolve-jiti.test.ts` + `cli-parse.test.ts > daemon spawn jiti resolution` unrelated to this change — verified by running same tests on `git stash`'d baseline.)
- [x] 10.6 Run `npm run build` to confirm the client compiles with the new dialog and hook.
- [x] 10.7 Manual smoke test: start dev server, open Settings → Pi Ecosystem, force a stale `currentVersion` via override or by editing managed `package.json`, verify the warning icon appears and the dialog renders breaking changes for `@mariozechner/pi-coding-agent`. (Deferred to user — requires running dashboard.)
