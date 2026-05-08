## Context

Pi (`@mariozechner/pi-coding-agent`) ships a Keep-a-Changelog-style `CHANGELOG.md` in every npm tarball. The dashboard's `pi-version-skew.ts` already detects when a newer pi version is available and `PiCoreChecker` already enumerates core packages with `currentVersion` and `latestVersion`. The existing `UnifiedPackagesSection` Core sub-group renders one row per core package with a per-row `[Update]` button wired to `POST /api/pi-core/update`.

What's missing is the **read-side surface**: a way to show users what's actually changing between versions before they click Update. The data is on disk (under `~/.pi-dashboard/node_modules/<scope>/<pkg>/CHANGELOG.md` for managed installs, or under the npm-global module dir for global installs), the format is mechanically parseable (H2 per release, fixed H3 sub-section taxonomy: `### Breaking Changes`, `### New Features`, `### Added`, `### Changed`, `### Fixed`), and each bullet often carries an issue/PR link in a predictable shape: `([#NNN](https://github.com/.../NNN))`.

Of pi's 216 historical releases, 36 (~17%) carry a `### Breaking Changes` section. Crucially, several are PATCH releases (e.g. `0.52.6` removed `/exit`), which means a major-bump heuristic would miss 100% of them in pre-1.0 land. The CHANGELOG is the authoritative source.

Stakeholders: end users running Settings → Pi Ecosystem; pi maintainer (zero changes required of them — convention is already followed); dashboard maintainers (read-only consumer, no protocol changes).

## Goals / Non-Goals

**Goals:**
- Surface the count and content of breaking changes between the user's installed pi version and the latest available version, before they click Update.
- Reuse pi's existing changelog discipline verbatim — show the original prose with link-bearing markdown so migration guidance lands intact.
- Add minimal visual chrome to existing rows: a single warning icon that renders **only** when there is something worth surfacing (= ≥1 `### Breaking Changes` section in `(current, latest]`).
- Keep the implementation purely additive: no changes to the bootstrap state machine, install pipeline, or `/reload` broadcast logic.

**Non-Goals:**
- Version selection / pinning / downgrade UI — explicitly deferred.
- Modifications to `BootstrapBanner`. The banner stays as a passive informational notice. All new UX lives inside `UnifiedPackagesSection`.
- Generic markdown parsing. The parser is hand-rolled around the four exact H3 headings pi uses; it does not aspire to handle every Keep-a-Changelog dialect.
- Per-package opt-in mechanism. The icon predicate is name-gated to `@mariozechner/pi-coding-agent` for v1; future packages will need a small explicit allowlist update.
- Auto-opening the dialog. The icon is the discovery affordance; click is required to open.

## Decisions

### 1. Server-side parsing, not client-side

**Decision:** parse the CHANGELOG on the server, return structured JSON to the client.

**Why:** the CHANGELOG file is on disk where the server runs (managed install: `~/.pi-dashboard/node_modules/...`; npm-global install: `npm root -g` + module path). The client has no filesystem access. Sending a 200 KB markdown file to the client and re-parsing on every dialog open also wastes bandwidth and CPU. The same parser output also drives the icon-rendering predicate, which means the client only needs to know `hasBreaking: boolean` to decide whether to render the icon — it doesn't need the full release list until the dialog opens.

**Alternatives considered:**
- *Fetch CHANGELOG.md from the npm registry / GitHub raw* — adds a network dependency and a second failure mode. The local copy is always authoritative for what was installed.
- *Client-side parsing of a server-streamed file* — duplicates parser code in two languages, doubles the test surface for zero gain.

### 2. Regex-based parser, not a full markdown AST

**Decision:** the parser uses two regexes (release-header line, sub-section-header line) and string slicing, treating each release as an ordered list of `(subsection, prose)` pairs.

**Why:** pi's CHANGELOG follows an extremely tight convention. The four section headings (`### Breaking Changes`, `### New Features` / `### Added`, `### Changed`, `### Fixed`) are case-sensitive, exact, and always at H3. Bullets are always `- ` at column 0. Issue links are `([#NNN](URL))` at end of bullet. A regex parser is ~80 lines and has zero deps; an AST-based one (e.g. `remark-parse`) is hundreds of LOC of dependency surface and only marginally more robust against malformed input — which we should treat as a graceful-degradation case anyway.

**Trade-off:** if pi changes its convention (e.g. introduces `### Deprecated`), the parser returns the prose as a generic "Other" section instead of a typed slot. This is acceptable; the breaking-change extraction is what carries user value, and that section header is unlikely to be renamed.

### 3. Parser output shape

```ts
interface ChangelogRelease {
  version: string;          // "0.69.0"
  date: string | null;      // "2026-04-22" or null if unparseable
  breaking: ChangelogBullet[];
  features: ChangelogBullet[];   // union of New Features + Added
  changed: ChangelogBullet[];
  fixed: ChangelogBullet[];
  raw: string;                   // entire H2 section text (fallback render)
}

interface ChangelogBullet {
  text: string;                  // prose with markdown links preserved
  issues: { num: number; url: string }[];
}

interface ChangelogResponse {
  pkg: string;
  from: string;
  to: string;
  releases: ChangelogRelease[];  // ordered: latest first
  hasBreaking: boolean;          // any release has breaking.length > 0
  changelogUrl: string | null;   // GitHub link derived from package.json#repository
  parsedAt: string;              // ISO timestamp, for cache-staleness display
}
```

**Why:** the client needs `hasBreaking` upfront for the icon predicate; the dialog needs the typed sections so it can pin Breaking at top and collapse Other Changes; raw is kept as an escape hatch for malformed releases the parser couldn't slot. `changelogUrl` is computed once on the server from `repository.url` in `package.json` (with `/blob/main/CHANGELOG.md` appended), saving the client from re-deriving it.

### 4. Endpoint: single GET with version-range query

**Decision:** `GET /api/pi-core/changelog?pkg=<name>&from=<v>&to=<v>`.

**Why:** stateless, cacheable, exactly one round-trip per dialog open. The server filters the parser output to the half-open interval `(from, to]` so the client receives only relevant releases. Auth-gated identically to the rest of `/api/pi-core/*` (which today gates on `bootstrapState.status === "ready"` plus the network guard).

`pkg` is a query param rather than a path param so the scoped name `@mariozechner/pi-coding-agent` doesn't need URL-encoding gymnastics. Server validates the package against `PiCoreChecker.CORE_PACKAGE_NAMES` to prevent arbitrary filesystem reads.

**Alternatives considered:**
- *Embed changelog in `GET /api/pi-core/status` response* — bloats the existing payload that's polled every 30 minutes; most polls will have no consumer for the changelog.
- *Per-version path: `/api/pi-core/changelog/:pkg/:version`* — needs URL-encoding for `@scope/name` and many more requests for multi-release ranges.

### 5. 60-second in-memory cache, invalidated on update

**Decision:** the parser memoizes its result by `(pkg, mtime-of-CHANGELOG.md)` for 60s. Successful updates call `PiCoreChecker.invalidate()`, which now also clears the changelog cache.

**Why:** the CHANGELOG only changes when the package is reinstalled, which is rare; 60s is enough to absorb dialog open/close churn during a single user session. The mtime fingerprint catches the case where another process updates pi out-of-band.

### 6. Icon-rendering predicate is name-gated

**Decision:** `PackageRow` accepts `breakingChangeCount?: number` and `onShowWhatsNew?: () => void` props. The icon renders if and only if `breakingChangeCount && breakingChangeCount > 0`. `UnifiedPackagesSection` populates these props **only** for the row whose `name === "@mariozechner/pi-coding-agent"`.

**Why:** the dashboard's own CHANGELOG has zero `### Breaking Changes` sections, and other packages aren't held to the convention. Rendering the icon for them would either produce false negatives (no breaking changes ever surface) or false positives (icon never appears even when changes exist). Name-gating keeps v1 honest. A future change can promote this to a per-package opt-in field on the package metadata.

### 7. Dialog is modal via `DialogPortal`

**Decision:** `WhatsNewDialog` uses the existing `DialogPortal` pattern (matches `PackageReadmeDialog`, `PinDirectoryDialog`, etc.) — full-viewport backdrop, scroll lock, Esc to close, click-outside to close.

**Why:** consistency with existing modal patterns. The dialog is not a tooltip — it's a read-and-decide surface, possibly long, possibly with tappable links that escape to GitHub. Modal semantics are right.

The dialog has two CTAs at the footer:
- `[Cancel]` — closes the dialog.
- `[Update to <latest>]` — closes the dialog AND invokes the same handler the row's `[Update]` button uses.

### 8. Dialog content rules

- Breaking Changes section: pinned at top, **always expanded**. Each bullet renders with `MarkdownContent` so issue/PR links are clickable.
- New Features + Added: merged into "New features", **collapsed by default** with a toggle.
- Changed + Fixed: merged into "Other changes", **collapsed by default**.
- A footer link "Open full changelog on GitHub ↗" using `changelogUrl` if available.
- If `hasBreaking === false` AND the dialog is somehow opened (e.g. via future programmatic trigger), it still renders "New features" and "Other changes" as the primary content. The icon just won't be there to open it.

## Risks / Trade-offs

- **[Risk]** Parser silently produces wrong output if pi changes CHANGELOG conventions (e.g. switches to H2 sub-sections, changes section names). → **Mitigation:** parser surfaces an empty `breaking[]` rather than throwing; client falls back to "Open full changelog" link with no icon. Add a unit test that locks the four exact headings; CI fails if pi's bundled CHANGELOG no longer matches.
- **[Risk]** Long migration prose in a single bullet overflows the dialog. → **Mitigation:** dialog uses `max-height: 70vh` with internal scroll, matching `PackageReadmeDialog`.
- **[Risk]** User clicks `[Update to <latest>]` in the dialog, then a second update arrives while they're reading — they update to a stale `latest`. → **Mitigation:** the dialog reads `to` from the response it was opened with; if the underlying `PiCoreChecker.latestVersion` has moved, the next dialog open will reflect it. Worst case: user installs the version they intended, banner stays open suggesting the newer one. Acceptable.
- **[Trade-off]** Network: zero. CPU: trivial regex pass. Memory: ~50 KB per cached parse. The cache is bounded by the small set of core packages.
- **[Trade-off]** No streaming. The full response is one JSON object. Pi's CHANGELOG is ~150 KB total; even the worst case of "from: 0.0.1, to: 0.70.0" returning the full file is well within typical HTTP response budgets.
- **[Risk]** A user on a forked pi (`@oh-my-pi/pi-coding-agent`) sees nothing because the icon predicate is name-gated. → **Acceptable.** Documented behaviour in spec; add fork to allowlist when fork upstream commits to the same convention.

## Migration Plan

Pure additive. No data migration. No deprecations. Deployment is server restart + client refresh. Rollback is reverting the diff — no persisted state to clean up.
