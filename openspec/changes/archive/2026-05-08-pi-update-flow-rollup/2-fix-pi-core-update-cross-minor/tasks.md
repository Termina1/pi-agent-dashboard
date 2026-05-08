## 1. Update the executor

- [x] 1.1 In `packages/server/src/pi-core-updater.ts`, change the argv construction inside `defaultRunNpmUpdate` from `["update", "-g", pkg.name]` / `["update", pkg.name]` to `["install", "-g", `${pkg.name}@latest`]` / `["install", `${pkg.name}@latest`]`.
- [x] 1.2 Update the EACCES permission-hint message inside the same function from `sudo npm update -g <pkg>` to `sudo npm install -g <pkg>@latest`.
- [x] 1.3 Update the file-level docstring at the top of `pi-core-updater.ts` from "Runs `npm update -g <pkg>` … or `npm update <pkg>`" to "Runs `npm install -g <pkg>@latest` … or `npm install <pkg>@latest`" with a one-line note explaining why (range-pinning).

## 2. Update affected tests

- [x] 2.1 In `packages/server/src/__tests__/pi-core-updater-managed-path.test.ts`, update the "on Windows" test's assertion `expect(capturedArgs.slice(0, 2)).toEqual([..., "update"])` to expect `["install", ..., "@mariozechner/pi-coding-agent@latest"]` (or the relevant slice for the new argv shape).
- [x] 2.2 In the same file, update the EACCES permission-hint assertion `rejects.toThrow(/sudo npm update -g @example\/pkg/)` to match the new hint string `/sudo npm install -g @example\/pkg@latest/`.
- [x] 2.3 In `packages/server/src/__tests__/pi-core-updater.test.ts`, update the "passes install-source-aware args & cwd to runNpmUpdate" test if it pins the literal argv shape; the new shape is `["install", "<pkg>@latest"]` for managed and `["install", "-g", "<pkg>@latest"]` for global. (Verified: that test only inspects `name` and `installSource` via the `runNpmUpdate` stub seam, not literal argv — no change needed.)

## 3. Add the regression test

- [x] 3.1 In `packages/server/src/__tests__/pi-core-updater-managed-path.test.ts`, add a new test "spawns npm install with @latest suffix for managed install" that captures the spawned argv and asserts `args.some(a => a === "@mariozechner/pi-coding-agent@latest")`. Anchor explicitly on the `@latest` suffix.
- [x] 3.2 Add a parallel test for global install asserting `args.includes("-g")` AND `args.some(a => a.endsWith("@latest"))`.

## 4. Verify

- [x] 4.1 Run the targeted updater tests: `HOME=$(mktemp -d) npx vitest run packages/server/src/__tests__/pi-core-updater*.test.ts` — all green. (20/20 passing.)
- [x] 4.2 Run `npm run lint` — no new TypeScript errors introduced.
- [x] 4.3 Run the full server test suite: `HOME=$(mktemp -d) npx vitest run --project=@blackbelt-technology/pi-dashboard-server` — only the pre-existing failing tests (cli-parse / resolve-jiti) should remain. (Verified pi-core-checker / pi-core-routes / changelog-parser / pi-changelog-routes still pass: 45/45.)
- [ ] 4.4 Manual smoke test: with pi 0.70.6 installed in `~/.pi-dashboard/`, click `[Update]` in Settings → Pi Ecosystem → Core. Verify the post-update `currentVersion` reaches the registry `latest` (e.g. 0.73.1), bridges receive `/reload`, and the version label refreshes. (Deferred to user — requires running dashboard.)
