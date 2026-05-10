# Tasks

## 1. Add lockfile regen step to publish.yml

- [x] In `.github/workflows/publish.yml`, locate the `prepare` job's
      version-bump block (after `node scripts/sync-versions.js`,
      before the CHANGELOG promotion).
- [x] Insert a new step:

      ```yaml
      - name: Regenerate package-lock.json with bumped versions
        run: |
          # Lockfile must mirror the workspace version + cross-ref
          # specifier bumps that just happened above. Without this,
          # strict prerelease semver causes npm ci on consumers to
          # fall back to the registry. See change: fix-release-
          # lockfile-drift.
          npm install --package-lock-only --no-audit --no-fund
      ```

- [x] Confirm the existing `git add -A && git commit` step picks up
      the regenerated `package-lock.json` (it runs `git add -A`, so
      yes — but verify visually).

## 2. Add lockfile sanity assertion

- [x] Create `scripts/verify-lockfile-versions.mjs`:

      ```js
      #!/usr/bin/env node
      // Walks package-lock.json and asserts every recorded
      // cross-ref dep specifier on a @blackbelt-technology/*
      // workspace is "^<current-root-version>". Exits non-zero
      // with a file:specifier:expected report on mismatch.
      // See change: fix-release-lockfile-drift.

      import { readFileSync } from "node:fs";
      const root = JSON.parse(readFileSync("package.json", "utf8"));
      const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
      const expected = `^${root.version}`;
      const failures = [];
      for (const [k, v] of Object.entries(lock.packages)) {
        if (!k.startsWith("packages/")) continue;
        const deps = { ...(v.dependencies || {}), ...(v.devDependencies || {}) };
        for (const [name, spec] of Object.entries(deps)) {
          if (!name.startsWith("@blackbelt-technology/")) continue;
          if (spec !== expected) {
            failures.push(`  ${k} → ${name}: ${spec} (expected ${expected})`);
          }
        }
      }
      if (failures.length) {
        console.error("::error::Lockfile cross-ref drift detected. See change: fix-release-lockfile-drift.");
        for (const line of failures) console.error(line);
        process.exit(1);
      }
      console.log(`✓ All cross-ref specifiers match ${expected}`);
      ```

- [x] In `.github/workflows/publish.yml`, add a step right after
      step 1's regen:

      ```yaml
      - name: Verify lockfile matches workspace versions
        run: node scripts/verify-lockfile-versions.mjs
      ```

- [x] Test locally: cd into a clean clone, run `npm version 0.5.0
      --workspaces --include-workspace-root --allow-same-version`
      then `node scripts/sync-versions.js` then `npm install
      --package-lock-only` then the verify script. Confirm it
      passes.

## 3. Update `scripts/sync-versions.js` console hint

- [x] Replace the trailing console hint:

      ```js
      // Before
      console.log("   Remember to `rm -rf node_modules package-lock.json && npm install` to refresh the lockfile.");

      // After
      console.log("   Note: package-lock.json regeneration runs automatically");
      console.log("   in CI (publish.yml > prepare > 'Regenerate package-lock.json').");
      console.log("   For LOCAL bumps, run: npm install --package-lock-only");
      ```

## 4. Extend repo-level workflow lint

- [x] In `packages/shared/src/__tests__/publish-workflow-contract.test.ts`,
      add a new assertion:

      ```ts
      test("prepare job regenerates lockfile after version bump (fix-release-lockfile-drift)", () => {
        const wf = parseWorkflow(".github/workflows/publish.yml");
        const prepareSteps = wf.jobs.prepare.steps;
        const syncIdx = prepareSteps.findIndex(s => /sync-versions\.js/.test(s.run || ""));
        const regenIdx = prepareSteps.findIndex(s =>
          /npm install --package-lock-only/.test(s.run || ""));
        const commitIdx = prepareSteps.findIndex(s =>
          /git commit -m "chore\(release\)/.test(s.run || ""));
        expect(syncIdx, "sync-versions.js step missing").toBeGreaterThanOrEqual(0);
        expect(regenIdx, "lockfile regen step missing — see change fix-release-lockfile-drift")
          .toBeGreaterThan(syncIdx);
        expect(commitIdx, "git commit step missing").toBeGreaterThan(regenIdx);
      });
      ```

- [x] Run `npm test` and confirm the new assertion passes.

## 5. Update release-cut skill

- [x] In `.pi/skills/release-cut/SKILL.md`, add a sentence to the
      pre-flight notes section: *"If you're cutting a release
      LOCALLY (not via workflow_dispatch), run `npm install
      --package-lock-only` after `node scripts/sync-versions.js`
      and before the commit. The CI prepare job does this
      automatically."*

## 6. Documentation

- [x] Update `AGENTS.md` `.github/workflows/publish.yml` row to
      mention the new lockfile-regen step inline (alongside the
      existing notes about sync-versions.js).
- [x] Add a `scripts/verify-lockfile-versions.mjs` row to AGENTS.md
      after the existing `scripts/sync-versions.js` row.

## 7. Verification

- [x] After landing, the next test release tag (e.g.
      `v0.0.0-test-lockfile.1`) SHALL produce a tagged commit whose
      `package-lock.json` records every cross-ref specifier as
      `^0.0.0-test-lockfile.1` — verifiable post-tag with:

      ```bash
      git show <tag>:package-lock.json | jq -r '.packages | to_entries[] | select(.key | startswith("packages/")) | .value.dependencies // {} | to_entries[] | select(.key | startswith("@blackbelt-technology/")) | "\(.key)=\(.value)"' | sort -u
      ```

- [x] CI on the tag SHALL not fail with TS2305/TS2339 errors caused
      by stale-tarball resolution. (Other unrelated tsc errors
      remain out of scope.)
