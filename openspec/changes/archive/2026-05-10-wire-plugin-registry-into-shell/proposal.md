## Why

The dashboard plugin runtime is fully built but **never reaches the UI**. Two missing wires keep every manifest-declared slot claim invisible:

1. `packages/client/vite.config.ts` does **not** include `viteDashboardPluginsPlugin` in its `plugins[]` array. The comment at lines 5-7 acknowledges the plugin "is wired here but only active when …" — the actual `import { viteDashboardPluginsPlugin } … plugins: [react(), tailwindcss(), viteDashboardPluginsPlugin()]` line was never added. Result: `packages/client/src/generated/plugin-registry.tsx` is **never produced** on dev start or build.

2. `packages/client/src/App.tsx` line 86 keeps a placeholder registry:
   ```ts
   // Empty registry until real plugins register claims at build time
   const _pluginRegistry = createSlotRegistry();
   ```
   The "until" never arrived. `_pluginRegistry` is passed to `<PluginContextProvider>` permanently empty, so every `<SettingsSectionSlot>`, `<SessionCardBadgeSlot>`, etc. renders zero contributions even when manifests declare claims.

Symptoms today:

- `packages/demo-plugin/` ships claims for `settings-section` (DemoSettings) and `tool-renderer` (DemoToolRenderer) — neither renders anywhere.
- `packages/jj-plugin/` claims `settings-section`, `session-card-badge`, `command-route /jj`, etc. — none reach the runtime; the components only render via the legacy hard-coded imports in `SessionCard.tsx` / `App.tsx`.
- `packages/flows-plugin/` ditto for `session-card-badge` (`FlowActivityBadge`) and `session-card-action-bar` (`SessionFlowActions`) — only the hard-coded JSX paths in `SessionCard.tsx` work.
- `packages/flows-anthropic-bridge-plugin/` (just landed) — its `settings-section` claim is invisible until the registry is populated.

Existing artifacts assume this wiring exists:

- `openspec/changes/extract-subagents-as-plugin/proposal.md` cites *"the loader's generated `plugin-registry.tsx` imports plugins before any session subscription begins"*.
- `openspec/specs/dashboard-plugin-loader/spec.md` already requires the vite plugin to *"generate `packages/client/src/generated/plugin-registry.tsx` at dev start and on every build"*. The generation requirement exists; what's missing is the **invocation** of the plugin and the **consumption** of the generated file.

The fix is small but unblocks every deferred slot-consumer migration (`migrate-flows-jsx-to-slots`, `extract-git-as-plugin`, `extract-openspec-as-plugin`, `extract-subagents-as-plugin`).

## What Changes

- **MODIFY** `packages/client/vite.config.ts`:
  - Import `viteDashboardPluginsPlugin` from `@blackbelt-technology/dashboard-plugin-runtime/vite-plugin` (deferred / dynamic per existing comment so a fresh checkout without the runtime built doesn't break vite startup).
  - Add it to `plugins: [react(), tailwindcss(), viteDashboardPluginsPlugin()]`.
- **MODIFY** `packages/client/src/App.tsx`:
  - Replace `const _pluginRegistry = createSlotRegistry();` with a builder that reads `PLUGIN_REGISTRY` from the generated `./generated/plugin-registry` and inserts each claim into a fresh `SlotRegistry` via the runtime's existing API.
  - Keep `_pluginRegistry` empty when the generated file is absent (fresh checkout before first `vite dev` / `vite build`) — the registry just stays empty, no error.
- **ADD** `packages/client/src/generated/.gitignore` with a single `*` line — the generated file is build output, not source. Spec already says *"committed under a `.gitignore` rule"* (read: ignored, regenerated fresh).
- **ADD** repo-level lint test asserting that when ≥ 1 workspace plugin manifest exists, the generated registry is non-empty after `npm run build`. Lives at `packages/client/src/__tests__/plugin-registry-populated.test.ts`. Skips cleanly when run without a build artifact (so unit-test runs on a clean tree don't fail).
- **ADD** `dashboard-plugin-loader` spec deltas:
  - **MODIFIED** *"Vite plugin generates a static plugin registry"* — clarify that `vite.config.ts` MUST register the plugin (not just declare the dependency), and that the shell MUST consume the generated file.
  - **ADDED** *"Shell consumes the generated plugin registry"* — new requirement covering App.tsx wiring.

## Capabilities

### Modified Capabilities

- `dashboard-plugin-loader` — clarifies the existing "vite plugin generates registry" requirement and adds a sibling requirement that the shell actually loads it.

### New Capabilities

None. This change is the missing wiring for an existing capability.

## Impact

**Code touched:**

- `packages/client/vite.config.ts` — +2 LOC (import + plugin entry).
- `packages/client/src/App.tsx` — ~10 LOC (replace empty registry with populated one; preserve empty fallback).
- `packages/client/src/generated/.gitignore` — new file, 1 line.
- `packages/client/src/__tests__/plugin-registry-populated.test.ts` — new file, ~30 LOC.
- `openspec/specs/dashboard-plugin-loader/spec.md` — text edits in one existing requirement, new requirement added.

**Behavior changes (after wiring):**

- `demo-plugin/`'s DemoSettings appears in Settings → General (in dev/`fixture: true` excluded in production).
- `flows-plugin/`'s `FlowActivityBadge` and `SessionFlowActions` start rendering via slot consumers **in addition to** the hard-coded direct imports. The legacy direct imports are not removed in this change; that's deferred to `migrate-flows-jsx-to-slots`.
- `jj-plugin/`'s slot-based contributions render. Same co-tenancy rule applies.
- `flows-anthropic-bridge-plugin/`'s `FlowsAnthropicBridgeSettings` renders in Settings → General.

**Co-tenancy guarantee:** Per `2026-04-26-add-dashboard-shell-slots-runtime`, every existing slot consumer mount in the shell is **additive** — the slot renders alongside the legacy direct import. So populating the registry can only ADD UI, never remove or break existing UI. This is the safety guarantee that lets the change ship as a single small wiring patch.

## Migration Risks

- **Duplicate UI rendering.** `flows-plugin` claims `session-card-badge` for `FlowActivityBadge`. `SessionCard.tsx` currently imports `FlowActivityBadge` directly AND mounts `<SessionCardBadgeSlot>`. After this change, the badge will render twice on flow sessions. Mitigation: the legacy direct import in `SessionCard.tsx` SHALL be removed in this change for the two flows-plugin claims (`FlowActivityBadge`, `SessionFlowActions`) and the two jj-plugin claims that have direct imports (`JjWorkspaceBadge`, `JjActionBar`). Other plugins with slot claims that lack a corresponding direct import are unaffected. Visual regression test: snapshot session-card render with one flow + jj session before/after; expect identical structure (one badge, one action bar — not two).
- **Vite plugin import failure on fresh checkout.** A clean clone with `dashboard-plugin-runtime` not yet built could break `vite.config.ts` evaluation if the import is static. Mitigation: dynamic-import the plugin inside an `async` plugin factory wrapper, or use the deferred-import pattern alluded to in the existing vite.config.ts comment. Concrete shape:
  ```ts
  async function loadPluginsVitePlugin() {
    try {
      const mod = await import("@blackbelt-technology/dashboard-plugin-runtime/vite-plugin");
      return mod.viteDashboardPluginsPlugin?.() ?? null;
    } catch { return null; }
  }
  ```
  The `defineConfig` call awaits this and filters nulls from `plugins[]`.
- **HMR loop on manifest churn.** The vite plugin watches manifests and triggers HMR on change. If a manifest is in flux during a dev session, repeated regenerations could cause flicker. Mitigation: existing vite-plugin code already content-hashes manifests and skips regeneration on unchanged content (per `dashboard-plugin-loader` spec). No change required.
- **Test environment.** The `plugin-registry-populated.test.ts` regression test must run AFTER `npm run build`. CI already runs `build` before `test` in `.github/workflows/ci.yml`; locally `npm test` does not. Mitigation: the test detects absence of the generated file and emits a `test.skip(...)` rather than failing — keeps `npm test` working on a clean tree.

## References

- Generation spec (existing): `openspec/specs/dashboard-plugin-loader/spec.md` → *"Vite plugin generates a static plugin registry"*.
- Vite plugin implementation (already complete): `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts`.
- Empty-registry placeholder: `packages/client/src/App.tsx` line 86 (`// Empty registry until real plugins register claims at build time`).
- Co-tenancy guarantee: `openspec/changes/archive/2026-04-26-add-dashboard-shell-slots-runtime/tasks.md` tasks 6.2 and 6.3 (slot consumers mounted as additive co-tenants of legacy imports).
- Slot fallback regression-prevention: `openspec/changes/archive/2026-05-02-fix-slot-fallback-masks-content/` — when removing a legacy direct import in favor of a slot consumer inside a `??` chain, the lint test in `packages/client/src/__tests__/no-jsx-slot-nullish-fallback.test.ts` MUST be updated.
- Future Work cited by archived umbrella: `openspec/changes/archive/2026-04-26-dashboard-plugin-architecture/design.md` → "Future Work for `node_modules` scanning" (not in scope here; this change targets monorepo workspace plugins only).
