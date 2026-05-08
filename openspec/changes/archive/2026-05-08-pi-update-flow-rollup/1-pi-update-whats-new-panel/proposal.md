## Why

Today the dashboard surfaces "newer pi recommended" as a passive sentence and lets the user click `[Update]` with no context about what they're getting. Pi already publishes structured breaking-change information per release (a `### Breaking Changes` H3 section under every affected version in its bundled `CHANGELOG.md`), but the dashboard never reads it. Of pi's 216 releases, 36 (~17%) carry breaking changes — and several of those are PATCH releases (e.g. `0.52.6` removed `/exit`), so the major-version-bump heuristic that would otherwise be the obvious signal source misses 100% of pre-1.0 breaking changes.

The data is on disk after every install (`~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent/CHANGELOG.md`), the format is mechanically parseable, and the existing `PackageRow` already has a per-row Update button with full lifecycle states. All we lack is a read-side render of the changelog so users can read-then-decide instead of click-then-discover.

## What Changes

- Add a server-side CHANGELOG parser that extracts per-version `### Breaking Changes`, `### New Features`, `### Added`, `### Changed`, and `### Fixed` sections plus issue/PR links from a Keep-a-Changelog-style markdown file.
- Add `GET /api/pi-core/changelog?pkg=<name>&from=<version>&to=<version>` returning structured release entries between two versions, including a derived `hasBreaking` flag the UI can use without re-parsing.
- Add a `WhatsNewDialog` component (modal, via the existing `DialogPortal` pattern) that renders the parsed releases — breaking changes pinned at top, other changes collapsed by default, with a link out to the full GitHub CHANGELOG.
- Add a warning-icon affordance (`mdiAlertCircleOutline`) to existing `PackageRow` instances **only** when the current → latest range contains at least one `### Breaking Changes` section. Click opens `WhatsNewDialog`. The dialog has its own `[Update]` CTA wired to the same handler the row's `[Update]` button uses today.
- Cache parsed changelog responses in-memory for 60 seconds (matches the existing `pi-version-skew` cache TTL); any successful pi update invalidates the cache via the existing `PiCoreChecker.invalidate()` hook.

Scope-limiting decisions (what is intentionally NOT changing):
- No new install / upgrade endpoints. Existing `/api/bootstrap/upgrade-pi` and `/api/pi-core/update` are reused unchanged.
- No bootstrap state-machine changes. No `/reload` broadcast changes.
- No version selection / pinning / downgrade UI. The dialog is read-only "what's new", not a version picker.
- No `BootstrapBanner` modifications. The banner stays as-is (passive informational notice). All new UX lives inside Settings → Pi Ecosystem.
- Only `@mariozechner/pi-coding-agent` gets the warning icon today. The dashboard's own CHANGELOG has zero `### Breaking Changes` sections, and other packages aren't required to follow the convention. The parser/endpoint are package-agnostic so future packages can opt in trivially, but the icon-rendering predicate is name-gated for v1.

## Capabilities

### New Capabilities

- `pi-changelog-display`: Server-side parsing of Keep-a-Changelog-style `CHANGELOG.md` files installed alongside packages, plus the REST endpoint and modal dialog that surface the parsed result to users when an update is available. Covers parser semantics, endpoint contract, dialog content rules, and the warning-icon predicate.

### Modified Capabilities

- `pi-core-version-ui`: Existing per-row Update affordance gains a sibling warning-icon affordance that renders only when the row's `currentVersion → latestVersion` range contains breaking changes. Clicking the icon opens `WhatsNewDialog`. The row's existing `[Update]` button is unchanged.

## Impact

**New code (~290 LOC + ~250 LOC tests):**
- `packages/server/src/changelog-parser.ts` — pure parser over markdown text.
- `packages/server/src/routes/pi-changelog-routes.ts` — single GET route, auth-gated, registered alongside existing pi-core routes.
- `packages/client/src/components/WhatsNewDialog.tsx` — modal via `DialogPortal`.
- `packages/shared/src/changelog-types.ts` — shared `ChangelogRelease` / `ChangelogResponse` types.

**Touched code (~25 LOC):**
- `packages/client/src/components/PackageRow.tsx` — accepts an optional `breakingChangeCount` / `onShowWhatsNew` prop, renders the icon when count > 0.
- `packages/client/src/components/UnifiedPackagesSection.tsx` — fetches changelog on demand, threads props through the Core sub-group.
- `packages/server/src/server.ts` — register new routes module.

**Untouched:**
- Bootstrap state machine (`bootstrap-state.ts`, `bootstrap-routes.ts`, `pi-version-skew.ts`).
- Install pipeline (`bootstrap-install.ts`, `pi-core-updater.ts`, `package-manager-wrapper.ts`).
- Session `/reload` broadcast.
- `BootstrapBanner` (read-only as-is).

**Dependencies:** none added. Parser uses only `node:fs` + string operations. Client uses existing `MarkdownContent` for rendering link-bearing prose.

**Risk surface:** failed parse on malformed CHANGELOG → graceful fallback to "open full changelog" link with no breaking-changes panel. Cache invalidation — handled by hooking into `PiCoreChecker.invalidate()` which already fires after every successful core update. Network: zero (parser reads local filesystem only).
