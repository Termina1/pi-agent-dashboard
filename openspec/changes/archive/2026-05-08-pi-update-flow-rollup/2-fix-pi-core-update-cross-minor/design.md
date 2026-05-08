## Context

Two parallel "update pi" code paths exist on the server:

1. `POST /api/bootstrap/upgrade-pi` → `bootstrapInstall({ packages: ["@mariozechner/pi-coding-agent"] })` → `npm install <pkg>` (no version pin) in `~/.pi-dashboard/`. Always grabs npm `latest`.
2. `POST /api/pi-core/update` → `PiCoreUpdater.update(...)` → `defaultRunNpmUpdate(pkg)` → `npm update [-g] <pkg>`. Respects existing `package.json` range.

Both endpoints exist for historical reasons — bootstrap was added during the unified-bootstrap-install change for first-run / Electron-managed users; pi-core was the original path used by the global-npm-install user base. They diverged on verb choice without anyone noticing because, until pi started shipping breaking-minor releases (0.71+), `npm update` happened to land on the same version as `npm install <pkg>@latest`.

That symmetry is now broken. Pi 0.71, 0.72, and 0.73 all carry breaking changes; the dashboard's just-shipped What's New panel actively surfaces them; the user's expectation when clicking `[Update]` is "go to that latest version I just read about". The endpoints' divergent semantics now produce visibly broken behaviour.

## Goals / Non-Goals

**Goals:**
- Make the per-row `[Update]` button reach the npm `latest` dist-tag regardless of the consuming `package.json` range.
- Align `pi-core-update` with `bootstrap/upgrade-pi` semantics.
- Land a regression test that pins the new argv shape so a future "let's just use `npm update`, it's idiomatic" PR can't silently revert this.

**Non-Goals:**
- Removing one of the two endpoints. They have legitimately different scopes (bootstrap = pi-only; pi-core = any whitelisted core package). Convergence on argv ≠ convergence on routes.
- Adding a "stay on this version" pinning UI. Tracked separately.
- Cross-major upgrade gating (e.g. block 0.99 → 1.0 without confirmation). Tracked separately and would build on the What's New panel.
- Touching the global-install path's permission story (sudo, EACCES handling). The hint string updates, but the underlying logic is unchanged.

## Decisions

### 1. Replace `npm update` with `npm install <pkg>@latest` for both install sources

**Decision:** the spawned argv changes from `["update", "-g", pkg]` / `["update", pkg]` to `["install", "-g", pkg + "@latest"]` / `["install", pkg + "@latest"]`.

**Why:** this is the single behavioural change required to fix the bug. `npm install <pkg>@latest` ignores the consuming dep-range and fetches whatever the registry tags as `latest`. Same primitive `bootstrapInstall` already uses for managed-dir installs.

**Alternatives considered:**
- *Pre-rewrite the dep range on every update.* Read `package.json`, change `^0.70.0` to `*`, run `npm update`, restore range. Brittle, more I/O, more failure modes (race with another writer, partial state on crash).
- *Use `npm install <pkg>` with no version specifier.* Identical effect to `@latest` but conveys less intent in argv inspection / diagnostics.
- *Resolve the latest version in JS first, then pass `<pkg>@<version>`.* Useful if we ever add per-update version selection, but unnecessary for this fix and adds a network round-trip.

### 2. Permission-hint string updated to match the new argv

**Decision:** the EACCES hint text changes from `sudo npm update -g <pkg>` to `sudo npm install -g <pkg>@latest`.

**Why:** the hint must point the user at a command that actually does what they want. Telling them to run `sudo npm update -g <pkg>` reproduces the same range-pinning bug they're already hitting.

### 3. No changes to the JSON contract of `/api/pi-core/update`

**Decision:** the request body, response body, and progress / completion WS messages are unchanged.

**Why:** the bug is in the executor, not the protocol. Changing the public contract would needlessly invalidate client tests and force callers to update.

### 4. New regression test asserts `@latest` suffix

**Decision:** add a test capturing spawn args that asserts `args.includes("@mariozechner/pi-coding-agent@latest")` — not just `args.includes("install")`. The suffix is the hot bit.

**Why:** the bug-prone shape is `["install", "<pkg>"]` (which works, but only the first time and only for new installs). The fix-prone shape is `["install", "<pkg>@latest"]`. Anchoring on the suffix prevents the latter regressing to the former.

## Risks / Trade-offs

- **[Risk]** `npm install <pkg>@latest` rewrites the dependency range in the consuming `package.json`. → **Acceptable.** The rewrite is the desired outcome — without it, the next update cycle would be pinned again. There is no "I want to stay on 0.70" use case in the dashboard today; if/when version pinning lands, that flow will write an exact pin (`"0.70.6"`) which `npm install <pkg>@latest` would also overwrite — but pinning will use a different code path then anyway.
- **[Risk]** Concurrent writes to `~/.pi-dashboard/package.json` if a user clicks `[Update]` while a bootstrap install is running. → **Already mitigated.** `runExclusive` lock in `PackageManagerWrapper` serializes all package operations; bootstrap's 409-gate covers the bootstrap path.
- **[Risk]** The npm `latest` dist-tag changes between the moment the dashboard fetches the registry meta (showing "→ 0.73.1") and the moment npm resolves `@latest` during the spawn. The user might end up on `0.73.2` instead of `0.73.1`. → **Acceptable** and arguably desirable (always-newest-known-good). Re-fetching the registry meta inside the spawn would add latency for a vanishing-rarely-observed inconsistency. The What's New panel re-renders on `pi_core_update_complete` so the user immediately sees the actual installed version.
- **[Trade-off]** The argv change is observable in logs / error traces. A user who scraped log output for `npm update` will need to update their tooling. Not a real risk because the only known consumer is the test suite.

## Migration Plan

Pure additive code change. No data migration. No deprecations.
- Server restart picks up the new updater logic.
- No client invalidation needed.
- Rollback: revert the diff. The two affected files are localized.
