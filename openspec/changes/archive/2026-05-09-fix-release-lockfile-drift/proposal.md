## Why

Every release cut via `.github/workflows/publish.yml`'s `prepare` job
ships with a **stale `package-lock.json`** because the workflow bumps
every workspace's `package.json` version + cross-ref specifiers but
never regenerates the lockfile. This breaks consumers (and our own CI)
because of a strict-prerelease semver subtlety in npm.

### The failure mechanism

```
   1. prepare job:
      ├── npm version <ver> -ws --include-workspace-root
      │     → bumps every package.json's "version" field
      │
      ├── scripts/sync-versions.js
      │     → rewrites every cross-ref dep specifier from
      │       "^<old-ver>" to "^<new-ver>"
      │
      ├── (CHANGELOG promotion)
      ├── git add -A
      ├── git commit -m "chore(release): vX.Y.Z"
      ├── git tag vX.Y.Z
      └── git push   ← stale package-lock.json goes up

   2. The tagged commit's package-lock.json still records:
        packages/<workspace>/dependencies = "^<OLD-ver>"

   3. Subsequent `npm ci` (in CI or by a consumer):
      The strict prerelease semver rule says "^0.0.0-test.1"
      does NOT match a workspace at "0.0.0-test.2".
      → npm falls back to the registry → fetches the older
        published tarball → installs it nested at
        packages/<workspace>/node_modules/.../<dep>/

   4. The nested install masks the workspace symlink, so
      TypeScript / Vite / runtime resolves through the stale
      tarball — missing any types/exports added since the
      previous release.
```

### Observed symptom

CI run on `2f1d5ff` (after `v0.0.0-test-darwin-x64.2` cut) failed
the `lint` step with:

```
packages/extension/src/bridge.ts: error TS2339:
  Property 'askUserPromptTimeoutSeconds' does not exist on type 'DashboardConfig'.

packages/extension/src/vcs-info.ts: error TS2305:
  Module '"@blackbelt-technology/pi-dashboard-shared/types.js"'
  has no exported member 'JjState'.
```

Both symbols exist in the workspace source (`packages/shared/src/`).
TypeScript was reading from `packages/extension/node_modules/@blackbelt-technology/pi-dashboard-shared@0.4.5/src/types.ts`
— the previous published version — because the lockfile's stale
`^0.0.0-test-darwin-x64.1` specifier didn't match the workspace's
new `0.0.0-test-darwin-x64.2` version, so npm fell back to registry.

### The latent risk

This bug surfaces on every release after a feature lands in `shared/`
or any cross-package type. It will recur indefinitely until either:

1. The workflow regenerates the lockfile in lockstep with version
   bumps (this proposal), OR
2. Every contributor manually runs `npm install` after every release
   tag and commits the lockfile (operationally fragile), OR
3. We migrate to `pnpm` / `yarn` `workspace:` protocol (much bigger
   change; pnpm support discussed but not in scope here).

The bug also exists in non-release scenarios — `scripts/sync-versions.js`
itself prints a hint: `"Remember to rm -rf node_modules package-lock.json
&& npm install to refresh the lockfile"` — but the hint isn't actionable
inside CI and was missed during the v0.0.0-test-darwin-x64.2 cut.

## What Changes

### 1. Add lockfile regeneration to the `prepare` job

In `.github/workflows/publish.yml`'s `prepare` job, insert one step
between `node scripts/sync-versions.js` and the CHANGELOG promotion:

```yaml
- name: Regenerate package-lock.json with bumped versions
  run: |
    # The workspace symlink graph changed (every package.json's
    # version + cross-ref specifiers were bumped). The lockfile
    # must be regenerated so its recorded specifiers match,
    # otherwise strict prerelease semver causes npm ci to fall
    # back to the registry on every consumer install.
    # See change: fix-release-lockfile-drift.
    npm install --package-lock-only --no-audit --no-fund
```

`--package-lock-only` is intentional: it updates the lockfile
without touching `node_modules/`. The actual `npm install` for the
build comes later in the publish job. This keeps the prepare step
fast (~5 seconds) while guaranteeing the committed tag has a
lockfile in lockstep with the version bumps.

### 2. Sanity assertion right after regeneration

```yaml
- name: Verify lockfile matches workspace versions
  run: |
    # Pure node script (no jq dependency) — fail the job if any
    # workspace's recorded dep specifier still references the
    # OLD version. Prevents silent drift if step #1 misbehaves.
    node scripts/verify-lockfile-versions.mjs
```

A new `scripts/verify-lockfile-versions.mjs` reads `package-lock.json`,
walks `packages.<workspace>.dependencies` for every cross-ref entry
matching `@blackbelt-technology/pi-dashboard-*`, and asserts each
recorded specifier is `^<currentVersion>`. Exits non-zero with a
file:specifier:expected report if any mismatch.

### 3. Update `scripts/sync-versions.js` documentation

Replace the trailing console hint:

```js
// Before:
console.log("   Remember to `rm -rf node_modules package-lock.json && npm install` to refresh the lockfile.");

// After:
console.log("   Note: package-lock.json regeneration runs automatically");
console.log("   in CI (publish.yml > prepare > 'Regenerate package-lock.json').");
console.log("   For LOCAL bumps, run: npm install --package-lock-only");
```

### 4. Repo-level lint asserting the workflow contract

Add a small test in `packages/shared/src/__tests__/publish-workflow-contract.test.ts`
(extending the existing file) that parses `.github/workflows/publish.yml`
and asserts the `prepare` job contains:

- A step running `npm install --package-lock-only` (or equivalent).
- The step is positioned AFTER the `sync-versions.js` invocation and
  BEFORE the `git commit` step.

Failure message cites this change name so a future contributor who
removes the step learns where the rule comes from.

### 5. Out of scope

- **Migrating to pnpm or yarn workspaces** — orthogonal, much larger
  change, considered separately.
- **Changing the cross-ref pin style** (e.g., to exact versions or
  `workspace:*`) — would require either tooling change or release-
  process redesign.
- **Backfilling historical releases** — published tarballs at
  `0.4.5`, `0.0.0-test-darwin-x64.1`, etc. stay as-is; this only
  affects future releases.
- **Fixing the same drift in `ci.yml` / non-release branches** — the
  `prepare` job is the single source of truth; CI on develop runs
  against whatever was last committed. If the lockfile is in sync
  on every release commit, develop also stays in sync because the
  release commit is the only place version refs change.

## Impact

- **Affected files:**
  - `.github/workflows/publish.yml` — two new steps in `prepare` job
  - `scripts/sync-versions.js` — updated console hint
  - `scripts/verify-lockfile-versions.mjs` — new file, ~40 LOC
  - `packages/shared/src/__tests__/publish-workflow-contract.test.ts` — extended
- **Affected users:** none directly. Internal release-pipeline only.
- **CI cost:** +5 s per release (one `npm install --package-lock-only`).
- **Risk:** low — the fix is additive, gated to the prepare job, and
  has a sanity-assert step right after to catch any misbehavior.

## Risks

### Risk: `npm install --package-lock-only` writes unexpected diffs

If a transitive dep's version range allows a newer subdep to be
selected, regenerating the lockfile picks the newest. This could
include unrelated transitive bumps in the release commit. Mitigation:
the existing `prepare` job already runs `npm version` + sync-versions
inside a single commit; folding lockfile regen into the same commit
keeps the diff coherent. The change isn't introducing new
unpredictability — it's just making explicit what's already implicit
in any local `npm install`.

### Risk: lockfile regen surfaces a transitive conflict

Possible if a registry-published version of a workspace dep has been
yanked / renamed. Mitigation: the `verify-lockfile-versions.mjs` step
runs immediately after and fails the job if any cross-ref isn't at
the expected spec. Investigation can happen pre-tag rather than
post-publish.

### Risk: developers forget the local equivalent

A maintainer running `npm version` locally without regenerating the
lockfile will hit the same problem. The updated `sync-versions.js`
hint surfaces the right command (`npm install --package-lock-only`),
and the `release-cut` skill should be updated to call it (out of
scope for this proposal but tracked as a follow-up note in the
skill's tasks).

## Open questions

1. **Should the workflow also re-run `npm ci` after the regen** to
   verify the lockfile is internally consistent? Probably no — the
   `publish` and `electron` jobs already run `npm ci` on the tagged
   commit, and a broken lockfile would fail there. Adding it to
   `prepare` is duplicative.
2. **Should we backport the fix to a hotfix release** (e.g., v0.4.6)
   rather than waiting for the next planned release? The current
   release pipeline keeps producing broken tarballs every time a
   maintainer cuts a test release, which is the trigger for this
   bug. Recommend: ship in next release.
