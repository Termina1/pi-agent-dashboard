## Why

The "what's new" icon doesn't render when an update is genuinely available because we read the wrong CHANGELOG. The dashboard parses `~/.pi-dashboard/node_modules/<pkg>/CHANGELOG.md` — the file shipped with the installed version. By definition this file's most-recent entry is the **installed version itself**. Any release `> installedVersion` is not described in it.

Concretely: user is on pi 0.73.1, pi.dev advertises 0.74.0 as latest, dashboard queries `GET /api/pi-core/changelog?from=0.73.1&to=0.74.0`. The server reads the local file (which only lists up to `## [0.73.1]`), filters releases to the half-open interval `(0.73.1, 0.74.0]`, finds nothing, returns `releases: []`. The client sees `hasBreaking: false` AND `releases.length === 0`, so `piWhatsNewKind` resolves to `undefined`, and the icon doesn't render.

The whole point of the icon is to surface what's in the upcoming release. The data source has to be the **upstream** CHANGELOG (the one that's continuously updated as new versions ship), not the snapshot inside the installed tarball.

Pi maintainers already keep `CHANGELOG.md` at `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/CHANGELOG.md` — fetched directly from the repo's `main` branch, this URL always reflects the latest published state.

## What Changes

- Add a server-side remote-CHANGELOG fetcher that pulls the raw markdown from GitHub (`raw.githubusercontent.com/<org>/<repo>/main/<directory?>/CHANGELOG.md`) keyed by the package's `repository` field. Honours conditional GET via `If-None-Modified` / ETag where the response provides one; otherwise caches for 5 minutes.
- Modify the changelog route's parse path: prefer the **remote** parsed result over the **local** one when remote is reachable. The local file remains as a fallback for offline / network-failure scenarios.
- Honour `PI_OFFLINE` env (already used by pi-dev-version-check): when set, skip the remote fetch entirely and use only the local file.
- The `changelogUrl` field returned to the client (used for the "Open full changelog on GitHub" link in `WhatsNewDialog`) keeps using the same `/blob/main/` URL — different from the raw URL the parser fetches. The user-facing link points at the human-rendered GitHub view; the parser uses the raw text.

Scope-limiting decisions:
- Only `@mariozechner/pi-coding-agent` (and its declared scope-rename successors) gets remote CHANGELOG fetching for v1. Other core packages (e.g. `@blackbelt-technology/pi-agent-dashboard`) continue to use local-only since their CHANGELOG isn't on GitHub raw without a known stable URL.
- No persistence of remote responses to disk. 5-minute in-memory cache only.
- No retry / backoff. A single 10-second timeout (matches pi-dev-version-check). Failure → fall through to local.
- No changes to the `WhatsNewDialog` component, `usePiChangelog` hook, or `PackageRow` icon contract.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pi-changelog-display`: the existing parser and route gain a remote-fetch fast path that supersedes the local-file read when the package's `repository` resolves to a GitHub URL. The on-the-wire response shape (`ChangelogResponse`) is unchanged.

## Impact

**New code (~80 LOC + ~50 LOC tests):**
- `packages/server/src/changelog-remote.ts` — pure module: derives raw URL from a GitHub repo descriptor, fetches with timeout, returns text. No filesystem I/O.
- `packages/server/src/__tests__/changelog-remote.test.ts` — covers URL derivation (incl. monorepo `directory` subpath), 200 vs 404 vs network-error, timeout, PI_OFFLINE skip.

**Touched code (~30 LOC + ~20 LOC tests):**
- `packages/server/src/routes/pi-changelog-routes.ts` — try remote first, fall back to local. Cache key includes "remote" / "local" so a degradation doesn't poison the cache.
- `packages/server/src/__tests__/pi-changelog-routes.test.ts` — add a scenario for remote-success, remote-fail-fallback-local, both-empty.

**Untouched:**
- Parser (`changelog-parser.ts`) — already takes raw markdown text. Source-agnostic.
- Client hook (`usePiChangelog`) — same endpoint, same response shape.
- `WhatsNewDialog` — same content rules.
- `PackageRow` icon contract — same `whatsNewKind` predicate.

**Risk surface:**
- Network dependency on `raw.githubusercontent.com`. Failure → fall back to local file → behaviour identical to today (no icon for upcoming versions). No new failure mode.
- 5-minute cache prevents per-second flooding.
- HTTPS-only; no cert pinning beyond Node's default trust store.
