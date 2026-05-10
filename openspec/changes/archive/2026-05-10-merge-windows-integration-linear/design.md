## Context

`windows-integration-v2` (98 commits ahead of develop) is the authoritative source of truth for this merge — it has been manually Windows-validated (Phase 0 per `adapt-windows-integration-pr9`), has 2519/2519 tests green, and contains four bonus path-math bug fixes found by Robert during fresh-install validation that are absent from PR #9.

The problem is **reviewability**: v2 is not a clean linear history. It contains:

1. Two merge commits (`03ee843`, `e851b4e`) where conflicts were resolved.
2. Phase-tracking chore commits referencing v2-local state (`Phase 0 complete`, `Category A complete`, etc.) that make no sense outside v2.
3. Cherry-picked develop commits that now exist on develop under different SHAs (patch-ids drifted through rebasing).
4. One v2-local fixup (`31f5c68` — "restore 2519/2519") authored against the conflict-resolved merge state that will not replay cleanly onto a fresh base.

A reviewer looking at a PR of `v2 → develop` sees 98 commits, two of which are merges, and cannot easily tell what is net-new vs re-picked vs conflict-resolution.

**Decision: cherry-pick 63 curated commits onto a fresh branch in dependency order.** This produces a linear history reviewable as a single diff, at the cost of:

- Re-doing conflict resolution for the handful of commits that already hit conflicts on v2. Manageable; v2's commit messages document the resolutions.
- Losing the merge-context that was recorded in v2's merge commits. Mitigated by the curated cherry-pick list in `tasks.md`.
- Re-deriving test fixes instead of carrying `31f5c68` forward. Cleaner trail; phase 5 tasks explicit about this.

## Cherry-pick strategy

### Source of SHAs

All SHAs in `tasks.md` refer to `origin/windows-integration-v2`. They are listed with short SHA + subject for readability; the authoritative list is the 63 `+`-marked entries in `git cherry develop origin/windows-integration-v2`, minus the exclusions in proposal.md §"Excluded from this merge".

### Conflict resolution policy

- **File conflict with a commit already on develop** (drift cherry-pick). Resolution: `git checkout develop -- <file>` then `git cherry-pick --skip`, documented in the commit's phase completion chore commit.
- **Conflict with an earlier phase's commit on v3** (real integration conflict). Resolve using v2's resolved state as reference (`git show origin/windows-integration-v2:<file>`), rerun phase's validation gate.
- **Conflict in an OpenSpec artifact** (phase 7 archives). Prefer archived content over active content; `openspec validate` after each archive commit.

### Empty commits after cherry-pick

Some phase-7 archive commits may become empty if their content was superseded by a matching archive that already exists on develop. Use `git cherry-pick --allow-empty` and note in chore commit, or skip entirely if the archive directory is identical on develop.

## Branch lifecycle

```
develop @ 2a4445d
    │
    ├── git tag pre-windows-v3-merge          (rollback anchor)
    │
    └── git checkout -b windows-integration-v3
        │
        ├── Phase 0 (4 commits)               ← YOUR safety fixes
        │   └── validation gate: npm test green
        │
        ├── Phase 1 (~11 commits)             ← platform/ primitives
        │   └── validation gate: build green, 3 lint tests green
        │
        ├── Phase 2 (~7 commits)              ← Windows fixes
        │   └── validation gate: Windows manual smoke
        │
        ├── Phase 3 (4 commits)               ← Electron migration
        │   └── validation gate: Electron make ×3 platforms
        │
        ├── Phase 4 (~6 commits)              ← Bridge extension
        │   └── validation gate: ×3 session spawn smoke
        │
        ├── Phase 5 (~6 commits)              ← Test infra
        │   └── validation gate: full npm test green CI matrix
        │
        ├── Phase 6 (6 commits, separate)     ← Drift features
        │   └── validation gate: smoke each feature individually
        │
        ├── Phase 7 (~13 commits)             ← OpenSpec archives
        │   └── validation gate: openspec validate
        │
        └── PR to develop (squash = NO, merge-commit)
            │
            └── after merge: cut v0.4.0
```

## Phase 0 first — rationale

Robert's 4 path-math/node-guard commits (`4c564fc`, `40a1319`, `e11f5eb`, `93973206`) are:

1. Self-contained (no `platform/` dependency).
2. Fix regressions present on current develop (bridge auto-reg, server-launcher resolve, client-dir resolution, Node 22.0-22.17 compatibility).
3. Already tested (17 node-guard tests, 5 server-launcher tests, bridge/client-dir existing tests).
4. Authored by the same person driving this merge.

Landing them first means: if the remainder of the merge stalls for any reason, develop is still incrementally better. This is the "pre-PR-A sub-PR" idea from exploration, realized as Phase 0 of a single branch per user direction.

## Phase 5 test infra — re-derivation strategy

`31f5c68` ("restore 2519/2519") on v2 is explicitly excluded. Instead:

1. After Phase 4 completes, run full `npm test`.
2. Triage failures by package.
3. Apply v2's fixes as reference (`git show 31f5c68:<path>`), adapted to the fresh merge state.
4. Commit as `fix(tests): restore green baseline after phase-4 platform integration` — single squash commit rather than v2's incremental fix series.

Budget: estimated ~2h of triage; v2's fixes were against a similar merge-state, so they should largely transfer.

## Phase 6 drift features — separate commits, no spin-off

Per user direction (B3 + "when split, only make commit split, not branch"), the 6 drift-feature commits are cherry-picked individually onto the same `windows-integration-v3` branch:

- `1ee114c` harden ask_user argument validation
- `9446e43` pi-core version checker and update UI
- `6b39c3c` broadcast `pi_core_update_complete`
- `302c1c7` path-picker server-side filter
- `b80121f` zrok reservation leaks + bundle split + compression
- `850abe9` child_process-ok lint markers

These keep their original commit boundaries (no squash, no bundling). `b80121f` is already a triple-feature commit on v2; it stays as-is — surgically splitting it on the destination branch is not worth the effort.

## What is NOT in this merge (and why)

### `platform/` consolidation (18 → 13 files) — follow-up PR

Four refactor commits on v2 merge file sets:
- `a73178d` merge exec + subprocess-adapter + detached-spawn + spawn-mechanism → `spawn.ts`
- `2aa1d50` merge process-scan + process-identify → `process.ts`
- `21d7dc4` merge binary-lookup + runner + git + npm + openspec → `tools.ts`
- `ab017d8` merge commands + shell → `system.ts`

Plus `01ac562` (docs update). These are pure file moves with zero behaviour change — intentionally deferred so reviewers can focus on *behaviour* in this PR, and *file layout* in the follow-up. Tracked in a new change proposal after this one lands.

### Merge commits and phase-tracking chores

Explicitly skipped:
- `03ee843` merge integrate v2 Phase 0
- `e851b4e` merge origin/develop (45 commits)
- `4ccdee8`, `cc6e6f7`, `aa52c1c`, `6320525`, `eb32d4a`, `cd19bae` — Phase-N-complete chore commits

These are v2-local state tracking and would confuse reviewers in v3 context.

### Develop re-picks (patch-id drift)

Commits on v2 whose content matches today's `develop` under different SHAs:

| v2 SHA     | develop SHA | Subject                                          |
|------------|-------------|--------------------------------------------------|
| d0ad34a    | f2ec691     | CHANGELOG.md + release process                   |
| 590e65b    | 97dd4bd     | persistent editor PID registry                   |
| a465dc6    | c0bd183     | inline SVG brand + barber-pole                   |
| cec172a    | 4143d49     | CORS tunnel-origin allowlist                     |
| 1aee98c    | a343efa     | docs CORS + pre-compressed static                |
| 71406658   | 89d3bf6     | landing-page onboarding                          |
| 2d738c5    | c004806     | openspec card state pill + Tasks popover         |
| f067bd6    | 9510702     | archive cross-platform-qa-vms                    |
| 32cca61    | 852ccf8     | archive fix-portable-windows-package-manager     |
| 78b5ff6    | 7a0e926     | ask-user batch method                            |
| 56441a7    | 36bd96d     | session-header image paste                       |
| 99d9bbc    | 93e0bb8     | ci switch main → develop                         |
| 8f7421e    | 3cad40b     | node-pty spawn-helper execute permission         |
| 3deb4a5    | c975222     | archive fix-fork-entryid-timing                  |
| fad2957    | 6a1b1d8     | test environment isolation                       |
| 8fbf185    | 8737249     | node-pty hoist-aware permissions                 |
| 083c085    | 4b2b76c     | restore green baseline (Category A)              |

All skipped. If a file conflict arises during cherry-pick because v3 state expects v2's version: `git checkout develop -- <file>` and document.

## Open questions

1. **`v2`'s `2257b08` "docs: refine fix-fork-entryid-timing proposal"** — develop has `3deb4a5`'s archive of that proposal, but v2's refinements may have been folded in or lost during archival. Need to diff the archived content on develop vs v2's active version; if v2's refinements are missing, fold them into the archived content as a Phase 7 commit. Otherwise skip.

2. **Phase 2 ordering of fork-entryid-timing archive** vs active proposal refinements. `2257b08` refines the proposal before archival; `3deb4a5` archives it. Order in cherry-pick sequence matters only if we care about reproducing the narrative; since we're batching archives in Phase 7, take the final archived content from v2.

3. **CI cost** — validation gates imply running Electron make ×3 platforms, which costs CI minutes. Gate only on PR-ready commits (phase-end merges if we use `--no-ff`) rather than every commit. Open for final answer; default assumption is "gate at each phase's last commit, not per-cherry-pick".
