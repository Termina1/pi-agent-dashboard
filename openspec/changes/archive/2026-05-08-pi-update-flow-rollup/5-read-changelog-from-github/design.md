## Context

`packages/server/src/routes/pi-changelog-routes.ts` reads CHANGELOG.md via `readAndParseChangelog(pkg, located.changelogPath)` where `located.changelogPath` comes from `findChangelogPath()` walking the managed install + bare-import. Both paths land on a file-on-disk that ships with the installed package version.

For the "what's new about the upcoming version" use case, this is wrong by construction. The upcoming version's release notes live in the upstream repo's `main` branch, not in the snapshot we have. Two of pi.dev's contributions (the `version` field and the `packageName` field — both already used by `improve-pi-update-detection`) get the user past the version-detection problem; this change closes the loop by getting them past the **content** problem too.

Pi maintainers publish CHANGELOG.md at:
```
https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/CHANGELOG.md
```

Equivalent raw URL:
```
https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/CHANGELOG.md
```

## Goals / Non-Goals

**Goals:**
- The `[Update]` row's icon renders for any pending update where the upstream CHANGELOG has an entry for the upcoming version.
- Same trust model as pi-dev-version-check: HTTPS, default Node trust store, 10s timeout, env-skippable.
- Zero contract change for clients of `GET /api/pi-core/changelog`.

**Non-Goals:**
- Fetching CHANGELOG for non-pi packages. Other core packages don't have a known stable CHANGELOG URL on GitHub raw.
- Authenticated GitHub fetches. Public raw access is sufficient and rate-limited generously per IP.
- Persistent disk cache. 5-minute in-memory cache mirrors `PiCoreChecker`'s TTL and matches the cadence at which pi.dev version checks fire.

## Decisions

### 1. Raw URL is derived from the same `repository` field as the human URL

**Decision:** the existing `deriveChangelogUrl()` already reads `repository.url` + `repository.directory` and produces `https://github.com/<org>/<repo>/blob/main/<directory?>/CHANGELOG.md`. Add a sibling `deriveChangelogRawUrl()` that produces `https://raw.githubusercontent.com/<org>/<repo>/main/<directory?>/CHANGELOG.md` from the same input.

**Why:** single source of truth for "where this package's GitHub home is." Both functions agree on `org`, `repo`, `directory`. The user-visible link points at the rendered view; the parser fetches raw.

### 2. Try remote first, then fall back to local

**Decision:** the route's parse step becomes:
```
1. derive remote URL from package.json#repository
2. if derivable AND PI_OFFLINE not set:
     fetch + parse remote → if non-empty, use it
3. else (or if remote failed / empty):
     read + parse local CHANGELOG.md from disk
```

**Why:** remote is the authoritative source for "what's in the next release." Local stays as a fallback for offline users, dev installs without a `repository` field, and packages where remote returns 404. Either source feeds the same parser, so the response shape is identical.

The cache key incorporates the source ("remote" vs "local") so a transient network failure that briefly drops us to local doesn't poison the cache for the rest of the TTL.

**Alternative considered:** local-first, remote only when local has nothing > installed version. Rejected — the rule "remote if reachable" is simpler and the latency cost of a single GitHub raw GET behind a 5-min cache is negligible. Also: a user might be exactly on the latest version, in which case local is perfectly current — but checking "is local already at latest?" requires reading + parsing local first, doubling the work for the common upgrade-needed case.

### 3. 5-minute cache, HTTP-conditional refresh when supported

**Decision:** in-memory cache keyed by `(pkg, source)` with 5-minute TTL. If the response includes an `ETag` header, the cache stores it and the next fetch sends `If-None-Match: <etag>` — a `304 Not Modified` reuses the cached body.

**Why:** GitHub raw returns ETags; conditional GET costs ~zero bandwidth and lets us extend cache freshness without re-downloading the file. Falls back gracefully when ETag absent (just expires after 5 min).

### 4. Same parser, same response shape

**Decision:** `ChangelogResponse` is unchanged. The route still returns `{ releases, hasBreaking, changelogUrl, parsedAt }`. Clients see no difference except that `releases` now contains entries for upcoming versions.

**Why:** zero contract churn. The whole point of separating "fetch source" from "parse" was to enable this kind of swap.

## Risks / Trade-offs

- **[Risk]** GitHub raw is unreachable / rate-limited / network-firewalled. → **Mitigation:** fall back to local. Worst case: behaviour identical to before this change (icon hidden for upcoming versions).
- **[Risk]** A user's pi maintainer has changed the repository host (e.g. moves to GitLab). → **Mitigation:** `deriveChangelogUrl` already returns null for non-GitHub repos. Remote fetch is skipped; falls back to local; user still sees correct behaviour for their installed version.
- **[Risk]** GitHub serves stale content briefly after a release (CDN propagation). → **Acceptable.** A user might see a 30-second-old CHANGELOG; reload-and-retry refreshes.
- **[Trade-off]** Adds a network dependency to a previously-local-only route. The 5-minute cache + 10s timeout + graceful fallback together keep this from being a regression on flaky networks.
- **[Trade-off]** `raw.githubusercontent.com` is an additional egress URL the dashboard contacts. Documented; firewalled environments can set `PI_OFFLINE=1` to opt out.

## Migration Plan

Pure additive code change. No data migration. Server restart picks up the new route logic. Client doesn't need a rebuild — same response shape.

Rollback: revert the diff. Two files (one new, one modified). Cache is in-memory; no persistent state to clean up.
