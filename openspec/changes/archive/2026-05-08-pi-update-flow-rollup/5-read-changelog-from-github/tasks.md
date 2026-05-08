## 1. Remote-fetch module

- [x] 1.1 Create `packages/server/src/changelog-remote.ts` exporting:
  - `deriveChangelogRawUrl(repository: unknown): string | null` — sibling of `deriveChangelogUrl`, returns `https://raw.githubusercontent.com/<org>/<repo>/main/<directory?>/CHANGELOG.md` or `null` for non-GitHub / unparseable input.
  - `fetchRemoteChangelog(rawUrl, opts?): Promise<{ text: string; etag: string | null } | null>` — 10s timeout via `AbortSignal.timeout`. Returns `null` on any failure (network, non-2xx, abort, malformed). Supports `If-None-Match` request via opts.etag; on `304 Not Modified` returns the special sentinel `{ text: "", etag: <same>, notModified: true }` — wait, simpler: signal "not modified" via a discriminated return. Use `{ status: "ok", text, etag }` | `{ status: "not-modified" }` | `null`.
  - Honour `PI_OFFLINE` env: short-circuit to `null`.
- [x] 1.2 Add tests in `packages/server/src/__tests__/changelog-remote.test.ts`: URL derivation (no directory, with directory, monorepo, github: shorthand, ssh form), non-GitHub returns null, missing/empty repository returns null, fetch success returns `{status:"ok", text, etag}`, fetch 404 returns null, fetch network-error returns null, fetch with valid etag and 304 response returns `{status:"not-modified"}`, PI_OFFLINE skips fetch entirely.

## 2. Route integration

- [x] 2.1 In `packages/server/src/routes/pi-changelog-routes.ts`, change the parse step:
  1. Read package.json and derive both `changelogUrl` (human) and rawUrl (parser-input).
  2. If rawUrl derivable AND `PI_OFFLINE` not set:
     - Try `fetchRemoteChangelog` with cached etag (if any) — on success → parse + return.
     - On `not-modified` → reuse cached parsed result.
     - On null → fall through.
  3. Read + parse local CHANGELOG via existing `readAndParseChangelog`.
  4. Return whichever produced non-empty releases (prefer remote on success).
- [x] 2.2 Extend the changelog cache key in `changelog-parser.ts` from `pkg` to `(pkg, source)` where source is `"remote" | "local"`. Update `invalidateChangelogCache(pkg?)` to clear ALL source-keyed entries for that pkg.
- [x] 2.3 Cache the ETag returned by remote responses alongside the parsed releases so the next fetch can use conditional GET. The ETag store can be a separate map; mtime is irrelevant for remote.

## 3. Tests

- [x] 3.1 In `packages/server/src/__tests__/pi-changelog-routes.test.ts`, add scenarios:
  - Remote returns markdown containing entry for the upcoming version → response.releases includes that entry, hasBreaking reflects it.
  - Remote fetch fails → falls back to local, response shape unchanged.
  - PI_OFFLINE=1 → never hits remote, response identical to today's local-only behaviour.
- [x] 3.2 Use a stubbed fetch (the existing `fetchImpl` injection pattern) — NEVER hit live raw.githubusercontent.com from CI.
- [x] 3.3 Add a focused test for cache key separation: a remote-success then a remote-failure → second response uses local-cached path, first response remains remote-cached.

## 4. Verify

- [x] 4.1 Run targeted tests: `HOME=$(mktemp -d) npx vitest run packages/server/src/__tests__/changelog-remote.test.ts packages/server/src/__tests__/pi-changelog-routes.test.ts packages/server/src/__tests__/changelog-parser.test.ts` — all green.
- [x] 4.2 `npm run lint` — no new TypeScript errors.
- [ ] 4.3 Manual smoke: with pi 0.73.1 installed (no local entry for 0.74.0), restart server. Open Settings → Pi Ecosystem → Core. Verify the pi row shows the what's-new icon (info or breaking based on what 0.74.0's CHANGELOG entry contains). Click → dialog renders entries fetched from GitHub raw. (Deferred — requires running dashboard.)
