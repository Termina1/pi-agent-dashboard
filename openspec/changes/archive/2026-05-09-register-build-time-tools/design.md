## Context

The dashboard already centralizes runtime tool resolution behind `ToolRegistry` (introduced by `archive/2026-04-19-consolidate-tool-resolution`). The registry resolves binaries and modules through an ordered strategy chain (`override` → `bare-import` → `managed` → `npm-global` → `where`), caches resolutions, exposes diagnostics, supports user overrides via `~/.pi/dashboard/tool-overrides.json`, and is unit-tested through the bootstrap-resolution-harness (`packages/shared/src/__tests__/bootstrap/`).

Despite this, three build-time call sites still hardcode `node_modules/<dep>` paths:

```
.github/workflows/publish.yml:90-93
  → cd packages/electron/node_modules/electron && node install.js
  → patched by 61b3c6e to use inline `node -e require.resolve(...)`
  → patched IN PLACE; not registered in the registry

packages/electron/scripts/Dockerfile.build:33
  → cd packages/electron/node_modules/electron && node install.js
  → STILL BROKEN (will fail next Docker cross-build)

scripts/fix-pty-permissions.cjs:12
  → path.join(__dirname, "..", "node_modules", "node-pty", "prebuilds")
  → STILL BROKEN (silently fails on every fresh root install)
  → Sister script at packages/server/scripts/fix-pty-permissions.cjs
    already does this correctly with require.resolve
```

The hoisting layout changed in `f51e352` (workspace publishing fix) when `workspace:*` cross-refs were replaced with plain semver, allowing npm to use its default workspace hoisting. Electron and node-pty now hoist to the root `node_modules/` rather than nesting under their workspace.

The proposal is a direct follow-up that:
1. Registers `electron` and `node-pty` in the existing registry.
2. Adds a shell-callable resolver wrapper so build-time scripts (YAML/Dockerfile) can use the registry without bundling code.
3. Migrates the three call sites.
4. Locks the fix in with a lint test that bans `node_modules/electron` and `node_modules/node-pty` substrings outside an explicit allowlist.

## Goals / Non-Goals

**Goals:**

- All three known hardcoded path sites resolve through `ToolRegistry`.
- Build-time scripts (workflows, Dockerfiles) can resolve registry tools without depending on the shared package's `dist/` build (i.e., the wrapper must be CommonJS and require no transpilation).
- `node-pty` resolution must work during root `npm install`'s postinstall phase, before any workspace package is built or installed.
- Reintroduction of hardcoded `node_modules/<dep>` paths is caught at test time, not at release time.
- The bootstrap-resolution-harness covers `electron` and `node-pty` under hoisted, nested, and missing layouts.

**Non-Goals:**

- Refactoring `61b3c6e`'s inline form is in-scope (publish.yml gets migrated to the wrapper) but reverting it as a "wrong fix" is not — it solved the immediate v0.4.0 release crisis correctly.
- Syncing the archived `tool-registry` capability into `openspec/specs/tool-registry/spec.md` is out of scope; it is a separate housekeeping concern. The spec delta in this change targets the capability by name (`tool-registry`) regardless of whether the main spec file exists yet.
- Generalizing the lint to ALL `node_modules/<dep>` substrings is out of scope; the rule is scoped to `electron` and `node-pty` for now and can be widened in a follow-up if needed.
- Replacing the v0.2.7 `--ignore-scripts` workaround for `phantomjs-prebuilt` is out of scope; we keep that strategy and only fix the path resolution that follows it.

## Decisions

### Decision 1: Two new tool definitions, both `kind: "module"`

Both `electron` and `node-pty` are npm modules whose useful artifacts live at deterministic paths inside the package directory (`electron/install.js`, `node-pty/prebuilds/`). The natural registry primitive is `resolveModule(name)`, which returns a `Resolution` whose `path` points at the package directory; consumers append the relative artifact path themselves.

**Alternative considered:** Add a third `kind: "directory"` for "give me the package's containing dir" and special-case it. Rejected — `resolveModule` already returns a directory path (it's `path.dirname(require.resolve(name + "/package.json"))` semantics). No new primitive is needed.

**Strategy chains:**

- `electron`:
  - `override` (per-tool override file)
  - `bare-import` (`require.resolve("electron/package.json", { paths: ["packages/electron"] })`) — handles both hoisted root and nested workspace layouts via Node's standard module resolution.
  - `managed` (`<MANAGED>/node_modules/electron/package.json`) — fallback for managed-install scenarios.
- `node-pty`:
  - `override`
  - `bare-import` (`require.resolve("node-pty/package.json")`) — postinstall-friendly. No `paths` option needed; node-pty is a direct dependency of `packages/server`, so it always hoists.

The `npm-global` strategy is intentionally NOT included for either. Build-time consumers are operating inside the repo checkout; a globally-installed electron or node-pty would be the wrong artifact (different version, different prebuilds).

### Decision 2: Shell-callable wrapper at `packages/shared/bin/pi-dashboard-resolve-tool.cjs`

Build-time consumers (`publish.yml`, `Dockerfile.build`) cannot import the shared package's TypeScript directly. We need a CommonJS entry point that can be invoked as `node packages/shared/bin/pi-dashboard-resolve-tool.cjs <tool-name>` and prints the resolved path to stdout.

**Why CJS, not ESM:** When the wrapper is invoked from a build step running before any TypeScript build, `dist/` does not exist; the wrapper must rely on the source-of-truth `registry.ts` either by `tsx`/`jiti` compilation OR by re-implementing the resolution inline. We choose **inline reimplementation of the strategy chain semantics** (~30 lines) — the wrapper hand-rolls the `bare-import` strategy with `createRequire(__filename).resolve(...)` and the `override` strategy by reading `~/.pi/dashboard/tool-overrides.json`. This is the same pattern already used by `61b3c6e`'s inline `node -e`, but lifted into a versioned, testable script.

**Alternative considered:** Make the CLI delegate to the actual `getDefaultRegistry()` via `tsx --import` or build the shared package before invoking. Rejected — adds a build dependency to a fix that should be self-contained, and `tsx` itself is one of the registered tools (chicken-and-egg during bootstrap).

**Alternative considered:** Inline `node -e "require.resolve(...)"` in each call site (Bence's pattern, applied uniformly). Rejected for build-time YAML/Dockerfile consumers because (a) the same logic ends up in 3 places, (b) the override file is not consulted, (c) the lint test cannot distinguish "inline correctness" from "inline regression".

**Schema of the wrapper's behavior** (matches the registry's contract):

```
$ node packages/shared/bin/pi-dashboard-resolve-tool.cjs electron
/abs/path/to/node_modules/electron
$ echo $?
0

$ node packages/shared/bin/pi-dashboard-resolve-tool.cjs nonexistent
Error: tool 'nonexistent' is not registered
$ echo $?
1
```

The wrapper supports `--json` to print a `Resolution` object including the `tried` trail for diagnostics:

```
$ node packages/shared/bin/pi-dashboard-resolve-tool.cjs electron --json
{"name":"electron","ok":true,"path":"/abs/...","source":"bare-import","tried":[...]}
```

### Decision 3: `fix-pty-permissions.cjs` stays inline (does not use the wrapper)

The root `postinstall` script runs DURING `npm install`, before any workspace package is published in the local `node_modules/.bin/`. Calling `node packages/shared/bin/pi-dashboard-resolve-tool.cjs node-pty` may work in practice (workspace symlinks are typically created before lifecycle scripts), but is fragile. Instead, `scripts/fix-pty-permissions.cjs` reimplements the `bare-import` strategy inline:

```js
let prebuildsDir;
try {
  const ptyPkg = require.resolve("node-pty/package.json");
  prebuildsDir = path.join(path.dirname(ptyPkg), "prebuilds");
} catch {
  process.exit(0); // soft no-op
}
```

This is **the same logic the registry's `bare-import` strategy executes** for `node-pty`. The lint test treats this single inline copy as allowlisted because it is intentionally the bootstrap-friendly twin of the registry strategy — both implementations must stay in sync.

**Alternative considered:** Delete `scripts/fix-pty-permissions.cjs` and have the root postinstall delegate to `packages/server/scripts/fix-pty-permissions.cjs`. Rejected — workspaces' postinstall hooks fire on the workspace directory, not the root; the root's postinstall does not implicitly run nested workspace postinstalls in all npm versions, so the root copy is needed.

### Decision 4: Lint enforcement via vitest, not eslint or shellcheck

The repo has three existing repo-level lint vitest tests:
- `packages/shared/src/__tests__/no-direct-process-kill.test.ts`
- `packages/shared/src/__tests__/no-raw-node-import.test.ts`
- `packages/extension/src/__tests__/no-session-replacement-calls.test.ts`
- `packages/shared/src/__tests__/no-direct-child-process.test.ts`

Each scans a scoped subset of the codebase via `fs.readFileSync` + regex and fails with `file:line` citations. The new test follows the same pattern:

```ts
// packages/shared/src/__tests__/no-hardcoded-node-modules-paths.test.ts
const PATTERN = /node_modules\/(electron|node-pty)/;
const SCOPE = [
  "packages/electron/scripts/Dockerfile.build",
  "packages/electron/scripts/*.sh",
  ".github/workflows/*.yml",
  "scripts/*.cjs", "scripts/*.sh",
];
const ALLOWLIST = [
  "scripts/fix-pty-permissions.cjs", // intentionally inline (Decision 3)
  // Intentional matches in comments are stripped before the regex
  // by line-prefixing logic.
];
```

The test reads each scoped file, strips comments, and fails if the pattern matches outside the allowlist. The output cites `file:line:col` matching the existing tests' format.

**Alternative considered:** ESLint custom rule. Rejected — ESLint does not parse YAML or Dockerfiles; would need a separate plugin chain.

**Alternative considered:** A bash-based grep step in CI. Rejected — does not run locally as part of `npm test`, so contributors discover it only after pushing.

### Decision 5: Bootstrap-harness families, not bespoke vitest specs

The repo already has the `bootstrap-resolution-harness` (`packages/shared/src/__tests__/bootstrap/`) with memfs-backed fixtures and a 1080-cell scenario cube. New tools register as additional families:

- `families/electron-resolution.test.ts` — cells: hoisted-root, nested-workspace, missing, overridden.
- `families/node-pty-resolution.test.ts` — cells: present-as-server-dep, missing-from-current-workspace, overridden.

This avoids duplicating fixture machinery and gives both new tools the same cross-platform × source × layout coverage that pi/openspec/etc. already enjoy.

## Risks / Trade-offs

- **[Risk] Wrapper's inline reimplementation drifts from registry's TypeScript implementation.**
  → Mitigation: the wrapper is ~30 lines; the bootstrap-harness families exercise it through the same scenarios they exercise the TS registry through (vitest can shell out to `node packages/shared/bin/pi-dashboard-resolve-tool.cjs` and assert the output matches the equivalent `getDefaultRegistry().resolveModule(name)` result). The lint test additionally requires the wrapper file to declare the strategy chain order in a comment that is grep-checked against `definitions.ts`.

- **[Risk] `paths: ["packages/electron"]` hint to `require.resolve` is path-relative — breaks if invoked from a different cwd.**
  → Mitigation: the wrapper resolves `paths` against the repo root using `findUp("package.json")` semantics. Build-time consumers always invoke from repo root in practice (publish.yml `working-directory` defaults to `${{ github.workspace }}`; Dockerfile `WORKDIR /build`), but the wrapper does not assume this.

- **[Risk] Adding bootstrap-harness families re-runs the full 1080-cell cube and inflates test time.**
  → Mitigation: families register themselves via the existing `scenarios.ts` registration pattern; cells are added incrementally, not multiplicatively. Verified by reading the harness before committing.

- **[Trade-off] We keep two parallel implementations of the `bare-import` strategy: the canonical TS one in `strategies.ts`, and the inline CJS one in `scripts/fix-pty-permissions.cjs`.**
  → Accepted because the postinstall context cannot consume the TS one. The bootstrap harness covers both with the same cell expectations, so drift surfaces in tests.

- **[Trade-off] The lint test creates one more place to update when adding new tools to the registry.**
  → Accepted; the cost is a single-line addition to either `PATTERN` or `ALLOWLIST` per tool, and the alternative (no lint) has already cost the project two undetected hardcoded-path bugs.

## Migration Plan

1. Land the registry definitions and wrapper script first (no consumer changes). Verify via existing harness that `electron` and `node-pty` resolve correctly in all layouts.
2. Migrate `publish.yml` line 92 to use the wrapper. Trigger a no-op tag push to a scratch tag (e.g., `v0.4.0-rc-build-time-tools`) to verify the linux/arm64 cell rebuilds successfully without the inline `node -e`.
3. Migrate `Dockerfile.build:33`. Run `bash packages/electron/scripts/build-installer.sh --linux` locally to verify the Docker cross-build succeeds.
4. Migrate `scripts/fix-pty-permissions.cjs`. Run `rm -rf node_modules && npm ci` and verify `find node_modules/node-pty/prebuilds -name spawn-helper -executable` returns hits.
5. Land the lint test last so it cannot block the migration steps. After landing, any reintroduction of a hardcoded path will fail `npm test` immediately.

**Rollback:** Each step is independently revertible. The wrapper script + registry definitions can ship without consumer migration; the lint test only activates after at least one consumer is migrated. If the wrapper fails on a specific runner, individual consumers can fall back to inline `node -e require.resolve(...)` (matching `61b3c6e`) without affecting the others.

## Open Questions

- **Q1: Should `tsx` be added to `electron`'s strategy chain so the wrapper itself can be invoked via `node --import tsx packages/shared/bin/pi-dashboard-resolve-tool.cjs` and consume the canonical TS registry?**
  Answer: No. `tsx` is itself a registered tool, and the wrapper must function before tsx is resolvable in some bootstrap scenarios. Inline reimplementation is the right call.

- **Q2: Should the wrapper expose other registered tools (`pi`, `openspec`, etc.) too, or just the build-time ones?**
  Answer: Yes — once the wrapper exists, it is trivial to extend to all registered tools. Build-time scripts that need any registered tool can use the same entry point. Out of scope for this proposal but a clean follow-up.

- **Q3: Should we also fix `packages/electron/scripts/test-electron-install.sh:90-92` (hardcoded `linux-x64` in node-pty prebuild copy step) as part of this change?**
  Answer: No — different class of issue (parameterization, not hoisting). Will be a separate proposal if anyone hits it. The lint pattern is scoped to `node_modules/<dep>` paths, not platform/arch hardcodes.

- **Q4: Does the archived `tool-registry` capability spec need to be synced into `openspec/specs/tool-registry/spec.md` first?**
  Answer: Not required for this change. OpenSpec deltas reference capabilities by name; the spec delta in this proposal will be applied to whatever main spec exists at archive time. If the main spec is still missing then, archival will surface that as a separate gap. Recommended follow-up: a dedicated `sync-tool-registry-spec` housekeeping change.
