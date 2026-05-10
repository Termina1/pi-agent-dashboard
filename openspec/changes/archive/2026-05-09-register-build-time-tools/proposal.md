## Why

Bence's `61b3c6e fix(ci): OIDC trusted publishing + dynamic electron path resolve` patched `.github/workflows/publish.yml` line 92 inline using a hand-rolled `node -e require.resolve(...)` after the workspace publishing refactor (`f51e352`) caused npm to hoist `electron` to the root `node_modules/`, breaking the v0.4.0 linux/arm64 release. The fix only patched **one** of three identical hardcoded `node_modules/<dep>` paths in the repo: `Dockerfile.build:33` (Docker cross-platform builds) and `scripts/fix-pty-permissions.cjs:12` (root postinstall) still assume the pre-hoist nested layout. The Docker bug will reproduce the v0.4.0 failure on the next cross-platform installer build; the postinstall bug already fails silently on every fresh root install, leaving `node-pty`'s `spawn-helper` without execute permission and producing `posix_spawnp failed` at terminal-spawn time. The repo already has `ToolRegistry` (introduced by `2026-04-19-consolidate-tool-resolution`) precisely to centralize this kind of resolution with hoist-aware strategies, override files, and a diagnostic trail — but `electron` and `node-pty` were never registered, so build-time consumers continue to hand-roll inline lookups.

## What Changes

- Register `electron` and `node-pty` as `kind: "module"` tools in `packages/shared/src/tool-registry/definitions.ts`, each with an ordered strategy chain (`override` → `bare-import` → `managed`) that resolves regardless of npm hoisting layout.
- Add a thin shell-callable CLI wrapper at `packages/shared/bin/pi-dashboard-resolve-tool.cjs` (CommonJS, no build step required) so build-time consumers can resolve tools via `node packages/shared/bin/pi-dashboard-resolve-tool.cjs <tool-name>` without depending on the shared package's `dist/` being built first.
- Migrate three hardcoded-path consumers to the registry:
  - `.github/workflows/publish.yml` line 92 (linux/arm64 electron rebuild step) — replace inline `node -e require.resolve(...)` with the new CLI wrapper.
  - `packages/electron/scripts/Dockerfile.build` line 33 (Docker cross-platform electron rebuild step) — replace `cd packages/electron/node_modules/electron` with the CLI wrapper.
  - `scripts/fix-pty-permissions.cjs` line 12 (root postinstall) — replace hardcoded `node_modules/node-pty/prebuilds` with `require.resolve("node-pty/package.json")` mirroring the `bare-import` strategy semantics. Stays CJS-inline (not via the CLI wrapper) because it must run during `npm install` before any workspace package is built.
- Extend the bootstrap-resolution-harness (`packages/shared/src/__tests__/bootstrap/`) with families covering: `electron` resolution under hoisted vs. nested vs. missing layouts; `node-pty` resolution under present vs. missing-from-workspace layouts.
- Add a repo-level lint vitest test `packages/shared/src/__tests__/no-hardcoded-node-modules-paths.test.ts` (mirroring the existing `no-direct-process-kill.test.ts` / `no-raw-node-import.test.ts` / `no-direct-child-process.test.ts` pattern) that scans `.github/workflows/`, `packages/electron/scripts/`, and root `scripts/` for `node_modules/electron` and `node_modules/node-pty` substrings outside an explicit allowlist.

## Capabilities

### New Capabilities

(none — this change extends an existing capability)

### Modified Capabilities

- `tool-registry`: Adds two new registered tool definitions (`electron`, `node-pty`) and a shell-callable resolver CLI surface. Specifies that build-time scripts (workflows, Dockerfiles, postinstall hooks) MUST use the registry rather than hardcoded `node_modules/<dep>` paths. Adds a lint enforcement requirement.

## Impact

- **Code (new files)**:
  - `packages/shared/bin/pi-dashboard-resolve-tool.cjs` (~30 lines, CommonJS) — shell-callable CLI that exposes `resolveModule(name).path` over a single argv arg.
  - `packages/shared/src/__tests__/bootstrap/families/electron-resolution.test.ts` (~80 lines).
  - `packages/shared/src/__tests__/bootstrap/families/node-pty-resolution.test.ts` (~50 lines).
  - `packages/shared/src/__tests__/no-hardcoded-node-modules-paths.test.ts` (~50 lines lint).

- **Code (modified files)**:
  - `packages/shared/src/tool-registry/definitions.ts` — add `electron` and `node-pty` to the registration block.
  - `.github/workflows/publish.yml` — replace inline `node -e require.resolve(...)` block (lines 90-93) with `node packages/shared/bin/pi-dashboard-resolve-tool.cjs electron`.
  - `packages/electron/scripts/Dockerfile.build` — replace line 33 `cd packages/electron/node_modules/electron && node install.js` with a registry-resolved path.
  - `scripts/fix-pty-permissions.cjs` — replace hardcoded `path.join(__dirname, "..", "node_modules", "node-pty", "prebuilds")` with `require.resolve("node-pty/package.json")` (mirroring the existing correct version at `packages/server/scripts/fix-pty-permissions.cjs`).
  - `package.json` — declare the new `bin` entry under `@blackbelt-technology/pi-dashboard-shared` package's `bin` field if needed (alternative: invoke directly by path, no bin entry).

- **Dependencies**: None added. Uses only `node:fs` / `node:path` / `node:module` (already used by the existing tool-registry).

- **Platforms**: Fixes the linux/arm64 release path that broke v0.4.0; fixes the Docker cross-platform build path that would break the next cross-build attempt; fixes the silent postinstall on macOS/Linux fresh installs. No platform regression risk — Windows arm64 and other matrix cells already use lifecycle scripts and don't hit either hardcoded path.

- **Risk**: Low. The registry is already production code; this change adds two definitions and refactors three callers. The lint test prevents reintroduction. The CLI wrapper is CJS so it works pre-build. The postinstall path keeps an inline `require.resolve` (not the CLI) because the shared package may not be installed yet during root `npm install` — mirrors the strategy semantics rather than the implementation.

- **Supersedes / follow-ups**: Direct follow-up to `archive/2026-04-19-consolidate-tool-resolution` — completes the consolidation by registering the two build-time tools that were missed in the original migration. Companion to `61b3c6e` (Bence's inline patch) by replacing the inline form with the registered form and applying the fix to the two remaining hardcoded sites. Open question (deferred): whether the archived `tool-registry` capability should be synced into `openspec/specs/tool-registry/spec.md` as a separate housekeeping change — does not block this change since spec deltas can target capabilities by name.
