## 1. Register tools in the registry

- [x] 1.1 Add `electron` module definition to `packages/shared/src/tool-registry/definitions.ts` with strategy chain `override` → `bare-import` (using `paths: ["packages/electron"]`) → `managed`
- [x] 1.2 Add `node-pty` module definition to `packages/shared/src/tool-registry/definitions.ts` with strategy chain `override` → `bare-import`
- [x] 1.3 Update the comment block in `definitions.ts` listing intentionally-NOT-registered tools to reflect that `electron` and `node-pty` are now registered
- [x] 1.4 Update `AGENTS.md` "Currently registered" list under `src/shared/tool-registry/definitions.ts` to include the two new tools

## 2. Bootstrap-harness coverage

- [ ] 2.1 Read `packages/shared/src/__tests__/bootstrap/scenarios.ts` and `harness.ts` to understand how to register new family files without expanding the cell cube
- [ ] 2.2 Create `packages/shared/src/__tests__/bootstrap/families/electron-resolution.test.ts` covering: hoisted-root layout (electron in `<repo>/node_modules/electron`), nested-workspace layout (`packages/electron/node_modules/electron`), missing layout (no electron anywhere), override layout (override file points to a custom path)
- [ ] 2.3 Create `packages/shared/src/__tests__/bootstrap/families/node-pty-resolution.test.ts` covering: present-as-server-dep layout, missing-from-current-workspace layout, override layout
- [ ] 2.4 Run `npm run test:bootstrap` and verify all new family cells pass; pipe output to `/tmp/pi-test.log` per AGENTS.md test workflow

> §2 (bootstrap-harness families) **deferred to a follow-up change**. Rationale: the harness's `scenarios.ts` cell cube + `fixtures/` machinery is a substantial surface, and the new `resolve-tool-cli.test.ts` (live `spawnSync`-based test, §3.6) plus the lint test (§7) already exercise the registry's `electron`/`node-pty` definitions end-to-end against the real layout. Adding harness families is a worthwhile-but-orthogonal investment in cross-platform / fixture-driven coverage; tracking as a follow-up so this change can land lean. See change: register-build-time-tools.

## 3. Shell-callable resolver wrapper

- [x] 3.1 Create `packages/shared/bin/pi-dashboard-resolve-tool.cjs` (CommonJS, ~30 lines) that accepts `<tool-name> [--json]` argv
- [x] 3.2 Inline-implement the `override` strategy: read `~/.pi/dashboard/tool-overrides.json` if present, validate path existence, return path + `source: "override"` on hit
- [x] 3.3 Inline-implement the `bare-import` strategy via `createRequire(path.join(repoRoot, "package.json")).resolve(toolName + "/package.json")` for both `electron` (with `paths: ["packages/electron"]`) and `node-pty` (no paths option)
- [x] 3.4 Hardcode the per-tool strategy chain order to match `definitions.ts`; include a top-of-file comment explicitly cross-referencing `definitions.ts` so drift is visible during code review
- [x] 3.5 Implement stdout (path + newline) on success, stderr error message + exit 1 on failure (without `--json`); JSON object on stdout + exit 0 with `--json` regardless of `ok`
- [x] 3.6 Add unit test `packages/shared/src/__tests__/resolve-tool-cli.test.ts` that spawns the script via `child_process.spawnSync(process.execPath, [scriptPath, ...args])` and asserts stdout/stderr/exit code for each scenario in the spec

## 4. Migrate consumer #1: publish.yml linux/arm64 step

- [x] 4.1 Read `.github/workflows/publish.yml` lines 80-100 to confirm the current inline `node -e require.resolve(...)` block
- [x] 4.2 Replace the inline block with `ELECTRON_DIR=$(node packages/shared/bin/pi-dashboard-resolve-tool.cjs electron)`; preserve the explanatory comment
- [x] 4.3 Verify the YAML parses (run `npx js-yaml .github/workflows/publish.yml > /dev/null` or equivalent) and that no `packages/electron/node_modules/electron` substring remains in the file

## 5. Migrate consumer #2: Dockerfile.build

- [x] 5.1 Read `packages/electron/scripts/Dockerfile.build` to confirm line 33 and surrounding RUN context
- [x] 5.2 Replace `RUN cd packages/electron/node_modules/electron && node install.js 2>&1 | tail -5` with a `RUN` step that resolves the directory via the wrapper, then cd's into it
- [ ] 5.3 Verify by running `docker build -f packages/electron/scripts/Dockerfile.build .` locally (or via `bash packages/electron/scripts/build-installer.sh --linux`) and confirming the rebuild step succeeds without "No such file or directory"

> 5.3 left for the user — requires Docker; deferred to manual smoke-test.

## 6. Migrate consumer #3: scripts/fix-pty-permissions.cjs

- [x] 6.1 Read both copies of `fix-pty-permissions.cjs` (root + `packages/server/scripts/`) to understand the divergence
- [x] 6.2 Rewrite root `scripts/fix-pty-permissions.cjs` to use `require.resolve("node-pty/package.json")` mirroring the server-side correct version; preserve the existing top-of-file comment style (Linux/macOS-only, exit 0 on Windows)
- [x] 6.3 Add explicit comment at the top of the rewritten file pointing at the registry's `bare-import` strategy as the canonical reference, so anyone editing it knows to keep the two in sync
- [x] 6.4 Verify by running `rm -rf node_modules && npm ci`, then `find node_modules/node-pty/prebuilds -name spawn-helper -executable | head` and confirming hits  *(verified with the live `node scripts/fix-pty-permissions.cjs` invocation against the current installed tree — spawn-helpers chmodded to 0o755; full clean reinstall left for the user)*

## 7. Lint enforcement

- [x] 7.1 Read existing lint tests `packages/shared/src/__tests__/no-direct-process-kill.test.ts` and `no-raw-node-import.test.ts` to mirror their file-scanning + comment-stripping pattern
- [x] 7.2 Create `packages/shared/src/__tests__/no-hardcoded-node-modules-paths.test.ts` scanning the migrated build-time files (publish.yml, ci.yml, Dockerfile.build, both fix-pty-permissions.cjs copies)
- [x] 7.3 Implement comment-stripping for YAML (`#`), shell (`#`), and JS/TS (`//`) line-comment prefixes before applying the regex
- [x] 7.4 Define the allowlist inside the test file with explanatory comments; allowlist `scripts/fix-pty-permissions.cjs` and `packages/server/scripts/fix-pty-permissions.cjs` (the `node-pty` token in those files is an argument to `require.resolve`, not a hardcoded path)
- [x] 7.5 Implement the failure message to cite `file:line:col` and reference the tool registry as the canonical replacement
- [x] 7.6 Run `npm test` and verify the new test passes against the migrated tree; manually introduce a hardcoded path into a test file and confirm the test fails with the expected citation, then revert  *(verified — temporary regression in publish.yml triggered failure with `.github/workflows/publish.yml:96:32  cd packages/electron/node_modules/electron && node install.js` citation; revert restored green)*

## 8. Documentation + AGENTS.md

- [x] 8.1 Update `AGENTS.md` to add an entry under "Key Files" for `packages/shared/bin/pi-dashboard-resolve-tool.cjs` describing its purpose and the strategy-chain mirror invariant
- [x] 8.2 Update `AGENTS.md` to add an entry for `packages/shared/src/__tests__/no-hardcoded-node-modules-paths.test.ts` mirroring the existing `no-direct-process-kill.test.ts` entry
- [x] 8.3 Update `docs/architecture.md` to mention the new build-time tool registrations + shell-callable wrapper under the Tool Resolution section
- [x] 8.4 Update `CHANGELOG.md` `## [Unreleased]` section with one-line entries describing: registry registration of electron + node-pty, build-time consumer migration, lint enforcement

## 9. Verification

- [x] 9.1 Run full `npm test 2>&1 | tee /tmp/pi-test.log` and grep for failures; address any  *(2 pre-existing failures in untracked `CommandInput.dropdown-select.probe.test.tsx` confirmed unrelated by stash + re-run; 3049 tests pass)*
- [x] 9.2 Run `npm run build` and confirm the TypeScript build still passes (no regression in shared package)
- [ ] 9.3 Run `rm -rf node_modules && npm ci` on a clean tree; confirm postinstall does not error and `find node_modules/node-pty/prebuilds -name spawn-helper -executable` returns hits on Linux/macOS  *(left for the user — destructive op against current working tree)*
- [ ] 9.4 Verify on a real GitHub Actions push (scratch tag or PR run) that the linux/arm64 publish.yml cell succeeds end-to-end through the rebuild step  *(left for the user — requires GH Actions CI run)*
- [ ] 9.5 Verify Docker cross-build via `bash packages/electron/scripts/build-installer.sh --linux` succeeds on a host that exercises Dockerfile.build  *(left for the user — requires Docker)*
- [x] 9.6 Confirm `openspec validate register-build-time-tools --strict` passes before archive
