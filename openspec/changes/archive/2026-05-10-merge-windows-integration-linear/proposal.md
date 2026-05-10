## Why

PR #9 (`windows-integration`) carries essential Windows correctness, a `platform/` abstraction layer with lint enforcement, and `ToolRegistry` binary resolution. An earlier attempt — `adapt-windows-integration-pr9` — chose to integrate on top of the PR branch itself (`windows-integration-v2`), which accumulated 98 commits including multiple merges and conflict-resolution fixups. That branch is functionally complete (57/89 tasks, 2519/2519 tests green) but is not reviewable as a single diff against `develop`.

This proposal **supersedes** `adapt-windows-integration-pr9` with a linear, curated cherry-pick plan onto a fresh branch off `develop`. Option **B3** from the exploration: a single working branch (`windows-integration-v3`), commits applied in dependency order, cross-platform core + unrelated drift features all delivered as separate commits on the same branch.

The goal is **one reviewable branch** that:
- Fixes known Windows-fresh-install bugs first (Robert's 4 path-math/node-guard commits).
- Introduces `platform/` primitives as a clean foundation (no mid-sequence file-consolidation noise).
- Migrates Electron, bridge, and server call sites to the new primitives.
- Carries along the handful of unrelated features that landed on `windows-integration-v2` during its develop-catch-up phases, each as its own commit for reviewability.
- Leaves the `platform/` 18→13 file consolidation (`a73178d`, `2aa1d50`, `21d7dc4`, `ab017d8`) for a **separate follow-up PR** — pure moves, zero behaviour change, easier to review in isolation.

## What Changes

Create `windows-integration-v3` off today's `develop` (`2a4445d`). Cherry-pick ~46 curated commits (primary source: `origin/windows-integration-v2`; 2 additional from `origin/windows-integration` HEAD that post-date v2) in seven phases matching the bucket structure identified during exploration. Each phase ends with a validation gate. Post-merge, cut `v0.4.0`.

Exact per-commit sequence is in `tasks.md`.

### Phase structure (all on one branch, linear order)

- **Phase 0 — Safety fixes first (bucket #5)**. 4 commits, all authored by Robert. Decouples "develop is broken on Windows fresh install" from the big refactor's review cycle. Ships first so even a partial merge leaves develop more correct.
- **Phase 1 — `platform/` foundation (bucket #1)**. ~11 commits. Introduces `packages/shared/src/platform/*` primitives and `ToolRegistry`. **Excludes** the 4 file-consolidation commits (`a73178d`, `2aa1d50`, `21d7dc4`, `ab017d8`) per §3.
- **Phase 2 — Windows-specific fixes (bucket #2)**. ~7 commits. Cross-platform server launch, PATHEXT handling, cmd.exe flash suppression, taskkill-based tree kill.
- **Phase 3 — Electron migration (bucket #3)**. ~4 commits. Electron surfaces adopt `ToolResolver` + `isDashboardRunning`.
- **Phase 4 — Bridge extension (bucket #4)**. ~6 commits. Server-readiness child-exit detection, spinner/Loader, spawn-failure surfacing.
- **Phase 5 — Test infra (bucket #6)**. ~6 commits. Platform-agnostic fixtures, Vitest 4 migration, green baseline restoration.
- **Phase 6 — Drift features (bucket #8)**. 6 commits. **NOT about Windows** — unrelated features that landed on v2 during develop-catch-up. Each kept as a separate commit (no squash). `b80121f` is the one bundle commit (zrok leaks + bundle split + compression); left as-is.
- **Phase 7 — OpenSpec archives + housekeeping (bucket #7)**. ~13 commits. Batched at the end rather than paired per-phase — simpler plan, same end state.

### Excluded from this merge

- **`platform/` consolidation** (18→13 files): `a73178d`, `2aa1d50`, `21d7dc4`, `ab017d8` + doc update `01ac562`. Follow-up PR after this one lands. Pure file moves.
- **Develop re-picks already on develop by content**: commits Botond cherry-picked onto v2 during its Category A/B catch-up that match commits already on today's `develop` under different SHAs (CHANGELOG consolidation, editor PID registry, CORS tunnel allowlist, landing page, ask-user batch, node-pty perms, test isolation tripwire, etc.). Skip during cherry-pick; resolve conflicts as "take develop's version".
- **Merge commits from v2** (`03ee843`, `e851b4e`) and Phase-tracking chore commits that reference v2-local state (`4ccdee8`, `cc6e6f7`, `aa52c1c`, `6320525`, `eb32d4a`, `cd19bae`, `4c564fc`-related completeness markers).
- **v2-local Phase-3.5 fixup** `31f5c68` (test restoration to 2519/2519): will re-conflict against a fresh base because it was authored against v2's conflict-resolved merge state. Phase 5 instead re-derives test fixes from red CI output.

### Out of scope

- Node-version preflight beyond `node-guard.ts` + `engines.node >= 22.18.0`. Preload-fastify-cjs workaround stays rejected (per v2's `BRANCH-COMPARISON.md` §10).
- New features beyond what the 63 curated commits introduce.
- The `adapt-windows-integration-pr9` proposal's Phase-per-category structure. This proposal is flat by bucket, not phased by category.

## Impact

### Specs affected (delta — full list)

- `platform-primitives` (NEW capability) — drafted at `openspec/changes/consolidate-platform-handlers/specs/platform-primitives/spec.md` on v2; sync as Phase 1 completes.
- `tool-registry` (NEW capability) — drafted at `openspec/changes/archive/2026-04-19-consolidate-tool-resolution/specs/tool-registry/spec.md` on v2.
- `platform-paths` (NEW capability) — drafted at `openspec/changes/platform-path-normalization/specs/platform-paths/spec.md` on v2.
- `dashboard-server`, `bridge-extension`, `command-executor`, `force-kill-handler`, `editor-detection` — amended specs (already drafted on v2).
- `cross-platform-merge-baseline` — durable requirements from `adapt-windows-integration-pr9` (spawnDetached detach option, `useWindowsRedirect` stdinMode gate, Vitest globalSetup tripwire integration, test-env-guard no-op for destructive sweeps). Migrated into this proposal's specs/.

### Code surface (repeat of exploration, for convenience)

- **High blast radius**: `packages/shared/src/platform/*`, `packages/shared/src/tool-registry/*`, `packages/server/src/cli.ts`, `packages/extension/src/server-launcher.ts`, `packages/server/src/process-manager.ts`.
- **Electron surface**: `packages/electron/src/lib/{app-menu,bundled-node,dependency-detector,dependency-installer,doctor,health-check,server-lifecycle}.ts`. Windows portable install + macOS/Linux node-pty perms are highest-risk.
- **Test infra**: Vitest 4 migration with root `vitest.config.ts`, mandatory `globalSetup` tripwire, `test-env-guard` no-op for destructive registry sweeps under `VITEST=true` + real `HOME`.

### Migration, compatibility, rollback

- **Migration**: none end-user. `engines.node` → `>=22.18.0`; older Node sees `node-guard.ts` preflight error with upgrade instructions.
- **Compatibility**: `health-check.ts` moves from `curl` probe to identity-verified `isDashboardRunning()`. Users with a stale/unverified dashboard on a custom port see "not running" post-upgrade — correct; flag in CHANGELOG.
- **Rollback**: tag `pre-windows-v3-merge` on `develop @ 2a4445d` before first cherry-pick. Any phase can roll back to that tag. If the merge ships and regresses, `v0.3.0` remains on npm + GitHub Releases; deprecate via `release-revoke` skill, do not unpublish.

### Validation gates (non-negotiable, repeated from `adapt-windows-integration-pr9` §4)

Before PR to develop:

- Full `npm test` green on Windows, macOS, Linux (CI matrix).
- `npm run build` green on all three.
- Electron make green on all three (DMG, AppImage, NSIS, ZIP).
- Manual Windows smoke: no cmd.exe flash on ×3 session spawn, `server.log` populated, `pi-dashboard stop` frees ports after crash, `/api/restart` works, zrok + QR works, editor iframe loads.
- Manual macOS + Linux smoke: landing page, session spawn, terminal, editor.
- All three lint-style tests green: `no-direct-child-process`, `no-direct-process-kill`, `no-direct-platform-branch`.

### Supersession

This proposal supersedes `adapt-windows-integration-pr9`. The superseded proposal's artifacts remain in `openspec/changes/adapt-windows-integration-pr9/` as historical record. Its durable requirements migrate into this proposal's `specs/cross-platform-merge-baseline/`.
