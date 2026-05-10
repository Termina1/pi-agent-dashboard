## ADDED Requirements

### Requirement: `spawnDetached` MUST accept an explicit `detach` option

`packages/shared/src/platform/detached-spawn.ts` `SpawnDetachedOptions` SHALL include an optional `detach?: boolean` field (default `true`). When `detach` is `false`, `spawnDetached` SHALL set `detached: false` on the underlying `child_process.spawn` call so the child remains inside the parent's libuv Job Object (Windows) or process group (POSIX) and no new console is allocated.

This requirement exists because commit `5ab7956` hard-coded `detached: true` for every caller, which reverted commit `d331850`'s no-flash fix for Windows pi-session spawning. Pi sessions are deliberately tied to the parent's lifecycle via RPC stdin-EOF; they MUST NOT outlive the parent, and `detached: false` is the mechanism.

Server auto-start (`packages/extension/src/server-launcher.ts`) keeps the default `detach: true` — it MUST outlive the bridge.

#### Scenario: Pi-session spawn with `detach: false` does not flash a console on Windows

- **GIVEN** a Windows host running the dashboard server
- **WHEN** a new pi session is spawned via `spawnHeadlessDetached` with `detach: false`
- **THEN** no cmd.exe window appears, even transiently
- **AND** the child process is terminated when the parent server exits (RPC stdin-EOF path)

#### Scenario: Server auto-start preserves `detach: true` default

- **GIVEN** a bridge extension auto-launching the dashboard server
- **WHEN** `server-launcher` calls `spawnDetached` without passing a `detach` option
- **THEN** the child SHALL be spawned with `detached: true`
- **AND** the child SHALL survive termination of the launching bridge process

### Requirement: `useWindowsRedirect` gate MUST check `stdinMode === "ignore"`

The cmd.exe redirect branch in `packages/shared/src/platform/detached-spawn.ts` SHALL only activate when all three conditions are true: `platform === "win32"`, `opts.logPath` is set, AND `stdinMode === "ignore"`. The `stdinMode === "ignore"` check is required because libuv only sets `CREATE_NO_WINDOW` when every stdio handle is ignored; a piped stdin negates the flag and allocates a visible console regardless of cmd.exe wrapping.

#### Scenario: Redirect branch refuses to run with piped stdin

- **GIVEN** a caller passing `stdinMode: "pipe"` and `logPath: "/tmp/x.log"` on Windows
- **WHEN** `spawnDetached` evaluates `useWindowsRedirect`
- **THEN** the gate SHALL return `false`
- **AND** the function SHALL fall through to direct node.exe spawn with `windowsHide: true` + `logFd` inheritance

#### Scenario: Redirect branch runs with ignore stdio

- **GIVEN** a caller passing `stdinMode: "ignore"` and `logPath: "/tmp/x.log"` on Windows
- **WHEN** `spawnDetached` evaluates `useWindowsRedirect`
- **THEN** the gate SHALL return `true`
- **AND** the child SHALL be wrapped via `cmd.exe /d /s /c` with `["ignore", "ignore", "ignore"]` stdio so `CREATE_NO_WINDOW` applies

### Requirement: Test suite MUST refuse to run against the real user `$HOME`

The shared test-support module `packages/shared/src/test-support/setup-home.ts` SHALL be wired as `globalSetup` in every workspace's `vitest.config.ts`. The module SHALL throw at vitest boot when `process.env.HOME === os.userInfo().homedir`, aborting the entire test run before any test file loads.

This requirement exists because windows-integration's consolidation commit `39acb1e` routes every process termination through `platform/process.ts`. Without the tripwire, destructive sweeps in `headlessPidRegistry.cleanupOrphans/killAll` and `editorPidRegistry.cleanupOrphans` SIGTERM the live pi session running the tests.

#### Scenario: Vitest invoked without ephemeral HOME aborts before loading any test

- **GIVEN** a developer running `npx vitest run` without a `HOME=$(mktemp -d)` prefix
- **WHEN** vitest boots `globalSetup`
- **THEN** `setup-home.ts` SHALL throw an instructive error
- **AND** no test file SHALL load
- **AND** no destructive sweep SHALL run against the real `~/.pi/` directory

#### Scenario: Vitest invoked via `npm test` passes the tripwire

- **GIVEN** the root `package.json` `test` script `HOME=$(mktemp -d -t pi-test-XXXXXX) vitest ...`
- **WHEN** `npm test` is run
- **THEN** `globalSetup` SHALL observe a HOME under `os.tmpdir()`
- **AND** `setup-home.ts` SHALL pre-create `<HOME>/.pi/agent/sessions/` and `<HOME>/.pi/dashboard/`
- **AND** tests SHALL proceed normally

### Requirement: Destructive registry sweeps MUST no-op when test-env-guard detects unsafe HOME

`packages/server/src/test-env-guard.ts` exports `isUnsafeTestHomeScan()` which returns `true` when `process.env.VITEST === "true"` AND `process.env.HOME === os.userInfo().homedir`. `headlessPidRegistry.cleanupOrphans`, `headlessPidRegistry.killAll`, and `editorPidRegistry.cleanupOrphans` SHALL consult this predicate and no-op with a `console.warn` when it returns `true`.

This is defense-in-depth: even if the `globalSetup` tripwire is disabled or bypassed, the guard prevents the sweep from SIGTERM-ing live pi processes.

#### Scenario: Sweep no-ops when VITEST=true and HOME is real user home

- **GIVEN** `VITEST=true` is set AND `process.env.HOME` equals `os.userInfo().homedir`
- **WHEN** `headlessPidRegistry.cleanupOrphans()` is called
- **THEN** the function SHALL log a warning to the console
- **AND** the function SHALL return without sending any signal

#### Scenario: Sweep runs normally in production

- **GIVEN** `VITEST` is unset OR `HOME` is an ephemeral tmp dir
- **WHEN** `headlessPidRegistry.cleanupOrphans()` is called
- **THEN** the function SHALL run its normal orphan-detection + SIGTERM logic
