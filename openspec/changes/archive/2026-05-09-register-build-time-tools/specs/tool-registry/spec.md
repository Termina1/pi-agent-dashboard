## ADDED Requirements

### Requirement: Build-time tool definitions

The registry SHALL ship with definitions for `electron` (kind: `module`) and `node-pty` (kind: `module`) in addition to the existing tool set defined by `2026-04-19-consolidate-tool-resolution`. Each definition SHALL declare an ordered strategy chain that resolves the package directory regardless of npm hoisting layout (nested under a workspace's `node_modules` OR hoisted to the workspace root).

#### Scenario: electron strategy chain

- **WHEN** `registry.resolveModule("electron")` runs
- **THEN** strategies SHALL be tried in order: `override`, `bare-import`, `managed`
- **AND** the `bare-import` strategy SHALL invoke `require.resolve("electron/package.json", { paths: ["packages/electron"] })`
- **AND** on success, `Resolution.path` SHALL be the directory containing the resolved `package.json` (i.e., the directory containing `electron/install.js`)

#### Scenario: electron resolves under hoisted layout

- **WHEN** `electron/package.json` exists at `<repoRoot>/node_modules/electron/package.json`
- **AND** `electron/package.json` does NOT exist at `<repoRoot>/packages/electron/node_modules/electron/package.json`
- **THEN** the `bare-import` strategy SHALL succeed
- **AND** `Resolution.path` SHALL equal `<repoRoot>/node_modules/electron`
- **AND** `Resolution.source` SHALL equal `"bare-import"`

#### Scenario: electron resolves under nested workspace layout

- **WHEN** `electron/package.json` exists at `<repoRoot>/packages/electron/node_modules/electron/package.json`
- **THEN** the `bare-import` strategy SHALL prefer the nested path
- **AND** `Resolution.path` SHALL equal `<repoRoot>/packages/electron/node_modules/electron`
- **AND** `Resolution.source` SHALL equal `"bare-import"`

#### Scenario: electron not installed in any layout

- **WHEN** `electron/package.json` exists in neither location and no override is set and no managed install is present
- **THEN** every strategy SHALL record `{ ok: false, reason: <descriptive string> }`
- **AND** `Resolution.ok` SHALL be `false`
- **AND** `Resolution.path` SHALL be `null`

#### Scenario: node-pty strategy chain

- **WHEN** `registry.resolveModule("node-pty")` runs
- **THEN** strategies SHALL be tried in order: `override`, `bare-import`
- **AND** the `bare-import` strategy SHALL invoke `require.resolve("node-pty/package.json")`
- **AND** on success, `Resolution.path` SHALL be the directory containing the resolved `package.json` (i.e., the directory containing `node-pty/prebuilds/`)

#### Scenario: node-pty missing in current workspace

- **WHEN** `registry.resolveModule("node-pty")` runs from a workspace context where `node-pty` is not resolvable via standard Node module lookup
- **AND** no override is set
- **THEN** the `bare-import` strategy SHALL record `{ ok: false, reason: "module not resolvable: node-pty" }`
- **AND** `Resolution.ok` SHALL be `false`
- **AND** callers SHALL treat this as a soft no-op (postinstall scripts MUST exit 0 without error)

### Requirement: Shell-callable tool resolver

The shared package SHALL expose a CommonJS shell-callable resolver at `packages/shared/bin/pi-dashboard-resolve-tool.cjs` so that build-time scripts (workflows, Dockerfiles) can resolve registered tools without depending on the shared package's TypeScript build output. The script SHALL be self-contained: it MUST NOT require `tsx`, `jiti`, or any other transpiler at invocation time.

#### Scenario: Resolver prints absolute path on success

- **WHEN** the resolver is invoked as `node packages/shared/bin/pi-dashboard-resolve-tool.cjs electron` from the repo root
- **AND** electron resolves successfully
- **THEN** the resolver SHALL print the absolute path of the resolved package directory to stdout, followed by a newline
- **AND** the process SHALL exit with code 0

#### Scenario: Resolver fails on unknown tool

- **WHEN** the resolver is invoked with a tool name that is not registered
- **THEN** the resolver SHALL print an error message naming the unknown tool to stderr
- **AND** SHALL exit with code 1

#### Scenario: Resolver fails on unresolvable tool

- **WHEN** the resolver is invoked for a registered tool that no strategy can resolve
- **THEN** the resolver SHALL print a message to stderr including the tried trail
- **AND** SHALL exit with code 1

#### Scenario: Resolver --json flag

- **WHEN** the resolver is invoked with `--json` as a second argument
- **THEN** the resolver SHALL print a JSON object matching the `Resolution` shape (`{ name, ok, path, source, tried, resolvedAt }`) to stdout
- **AND** SHALL exit with code 0 even when `ok` is `false` (the resolution outcome is encoded in the JSON, not the exit code, when `--json` is present)

#### Scenario: Resolver consults override file

- **WHEN** `~/.pi/dashboard/tool-overrides.json` contains a valid override for the requested tool
- **AND** the override path passes existence validation
- **THEN** the resolver SHALL print the override path
- **AND** the equivalent `--json` invocation SHALL report `source: "override"`

### Requirement: Build-time consumers use the registry

Build-time scripts that previously hardcoded `node_modules/<dep>` paths SHALL resolve those paths through the registry (via the shell-callable resolver for non-Node consumers, or via the inline `bare-import` semantics where the resolver itself is unavailable). The migrated sites are: `.github/workflows/publish.yml` (linux/arm64 electron rebuild step), `packages/electron/scripts/Dockerfile.build` (Docker cross-platform electron rebuild step), and `scripts/fix-pty-permissions.cjs` (root postinstall).

#### Scenario: publish.yml resolves electron via the resolver

- **WHEN** the linux/arm64 matrix cell executes the "Rebuild native modules" step
- **THEN** the step SHALL invoke `node packages/shared/bin/pi-dashboard-resolve-tool.cjs electron` to obtain the electron directory
- **AND** the step SHALL NOT contain a hardcoded `packages/electron/node_modules/electron` substring
- **AND** the step SHALL NOT contain an inline `node -e` invocation that hand-rolls `require.resolve` for electron

#### Scenario: Dockerfile.build resolves electron via the resolver

- **WHEN** the cross-platform Docker build runs `node install.js` for electron
- **THEN** the `RUN` step SHALL obtain the electron directory by invoking `node packages/shared/bin/pi-dashboard-resolve-tool.cjs electron`
- **AND** the `RUN` step SHALL NOT contain a hardcoded `packages/electron/node_modules/electron` substring

#### Scenario: fix-pty-permissions resolves node-pty via require.resolve

- **WHEN** the root `postinstall` hook executes `scripts/fix-pty-permissions.cjs`
- **THEN** the script SHALL resolve `node-pty/package.json` via `require.resolve("node-pty/package.json")` (matching the registry's `bare-import` strategy semantics)
- **AND** SHALL chmod every `prebuilds/<dir>/spawn-helper` file under the resolved directory to mode `0o755`
- **AND** SHALL exit with code 0 with no error output when `node-pty` is not resolvable
- **AND** SHALL NOT contain a hardcoded `node_modules/node-pty/prebuilds` substring

### Requirement: Lint enforcement of registry usage

A repo-level vitest test SHALL exist at `packages/shared/src/__tests__/no-hardcoded-node-modules-paths.test.ts` that scans a defined set of source files for `node_modules/electron` and `node_modules/node-pty` substrings outside an explicit allowlist. The test SHALL fail with a `file:line:col` citation when any non-allowlisted occurrence is found. This test SHALL run as part of `npm test`.

#### Scenario: Test scopes scan to build-time files

- **WHEN** the test runs
- **THEN** it SHALL scan `.github/workflows/*.yml`, `packages/electron/scripts/Dockerfile.build`, `packages/electron/scripts/*.sh`, `scripts/*.cjs`, and `scripts/*.sh`
- **AND** it SHALL NOT scan generated files, `dist/`, or `node_modules/`

#### Scenario: New hardcoded path triggers lint failure

- **WHEN** a contributor adds `cd node_modules/electron && ...` to any in-scope file
- **THEN** `npm test` SHALL fail
- **AND** the failure message SHALL cite the file, line, and column of the violation
- **AND** the failure message SHALL reference the tool registry as the canonical replacement

#### Scenario: Allowlisted inline copy is permitted

- **WHEN** the scan encounters `scripts/fix-pty-permissions.cjs` (the bootstrap-friendly inline twin of the `bare-import` strategy)
- **THEN** the test SHALL NOT fail on its `node_modules/node-pty` substring (if any) due to its presence on the allowlist
- **AND** the allowlist SHALL be defined inside the test file itself with explanatory comments

#### Scenario: Comments and string-prefixed lines are not false positives

- **WHEN** the scan encounters `node_modules/electron` inside a comment line (e.g., `# Electron may be hoisted to root node_modules ...`)
- **THEN** the test SHALL NOT report it as a violation
- **AND** the comment-stripping logic SHALL handle YAML `#`, shell `#`, and JS `//` comment prefixes
