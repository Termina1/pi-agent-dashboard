# Tasks

## 1. Preconditions

- [x] 1.1 Confirmed: `viteDashboardPluginsPlugin` exported from `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts` and exposed via the `./vite-plugin` subpath export in the package's `exports` map.
- [x] 1.2 Confirmed: `createSlotRegistry()` exposes `addClaim(claim: ClaimEntry)` (the actual API; tasks.md "register(manifest, claim)" was approximate). Generated registry already produces ClaimEntry-shaped objects with `Component` resolved, so `addClaim(claim)` is the correct insertion call.
- [x] 1.3 Inventory complete. Findings:
  - `App.tsx`: mounts `ContentViewSlot`, `ContentHeaderStickySlot`, `ContentInlineFooterSlot`, `ToastSlot`. No legacy direct imports of plugin components in App.tsx itself.
  - `SessionCard.tsx`: mounts `SessionCardBadgeSlot` + `SessionCardActionBarSlot`. Legacy direct imports: `FlowActivityBadge`, `SessionFlowActions` (flows-plugin), `JjWorkspaceBadge`, `JjActionBar`, `JjInitAffordance` (jj-plugin).
  - **Issue surfaced (see scope-down note below):** `FlowActivityBadge` and `SessionFlowActions` do NOT accept `{ session }` — they require explicit props from `App.tsx` state. Vite-plugin does not emit `predicate` into the generated registry, so wiring + manifest claims would render those components broken on every session card. **Resolution:** flows manifest claims temporarily emptied; flows direct imports stay; deferred to `migrate-flows-jsx-to-slots`. jj components self-gate on session state, so they are safe to migrate to slot-only rendering.

## 2. Vite plugin wiring

- [x] 2.1 `packages/client/vite.config.ts` updated: added async `loadPluginRegistryVitePlugin()` with try/catch around the dynamic import, converted `defineConfig` to async factory, awaited plugin spread into `plugins[]` (null-filtered). Orphaned NOTE comment removed.
- [x] 2.2 Will be verified by Section 10.2 (`npm run build`).
- [x] 2.3 Vite-plugin code already implements manifest watch + HMR (see `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts:configureServer`). Manual verification deferred to Section 10.4.

## 3. Generated dir + stub

- [x] 3.1 `packages/client/src/generated/.gitignore` written.
- [x] 3.2 `packages/client/src/generated/plugin-registry.tsx` stub committed.
- [x] 3.3 Verified via `git check-ignore` — `!plugin-registry.tsx` exception keeps the stub tracked.

## 4. Shell consumption

- [x] 4.1 `App.tsx` updated: imports `PLUGIN_REGISTRY` from `./generated/plugin-registry.js`, populates `_pluginRegistry` via `addClaim(claim)` loop. Provider wiring unchanged.
- [x] 4.2 `npx tsc --noEmit -p tsconfig.json` clean (root tsconfig used; `packages/client/tsconfig.json` has a pre-existing `composite: true` reference issue unrelated to this change).

## 5. Co-tenant direct-import removal (scoped)

**Scope-down note:** During Task 1.3 inventory we discovered `FlowActivityBadge` and `SessionFlowActions` do not accept `{ session }` (slot consumer's prop contract) and the vite-plugin does not emit `predicate` into the generated registry. Removing the direct flows imports without first adapting the components would leave slots calling `<FlowActivityBadge session={...}/>` with undefined required props on EVERY session. The flows-plugin manifest's `session-card-*` claims are therefore temporarily emptied (kept under a `//pi-dashboard-plugin-deferred-claims` comment) and direct imports stay until `migrate-flows-jsx-to-slots` adapts the components. jj-plugin components self-gate on session state, so they are safe to migrate.

- [x] 5.1 **DEFERRED** to `migrate-flows-jsx-to-slots` (proposal created). `FlowActivityBadge` direct usage retained; flows manifest claim emptied.
- [x] 5.2 **DEFERRED** to `migrate-flows-jsx-to-slots` (proposal created). `SessionFlowActions` direct usage retained; flows manifest claim emptied.
- [x] 5.3 `<JjWorkspaceBadge>`, `<JjActionBar>`, `<JjInitAffordance>` direct JSX block removed from `SessionCard.tsx`. Imports for jj-plugin components and `CurrentPluginLayer` removed (no other usage).
- [x] 5.4 No jj/flows direct usage in `App.tsx` — nothing to remove.
- [x] 5.5 `SCAN_FILES` in `no-jsx-slot-nullish-fallback.test.ts` extended with `"components/SessionCard.tsx"`.

## 6. Regression test

- [x] 6.1 `packages/client/src/__tests__/plugin-registry-populated.test.ts` created with skip-when-empty + slot-id + workspace-id assertions.
- [x] 6.2 Verified: `vitest run` reports `1 skipped` on a fresh tree (stub state).
- [x] 6.3 To be verified by Section 10.2 (`npm run build`) + Section 10.3 (`npm test`).

## 7. Visual regression check

**Scope-down note:** A full snapshot harness for `SessionCard` would require mocking `DashboardSession`, image assets, plugin context, and many handler callbacks. Tasks 7.1–7.3 are deferred to manual verification in Section 10.4. The expected visual delta of this change is:
  - jj-plugin row (`JjWorkspaceBadge` / `JjActionBar` / `JjInitAffordance`) moves from BETWEEN GitInfo and OpenSpec actions DOWN INTO the existing `<SessionCardActionBarSlot>` placement (i.e., below OpenSpec actions). One badge, one action bar — no doubles.
  - Flow JSX rendering unchanged (kept direct imports; manifest claims emptied).

- [x] 7.1 **DEFERRED to manual verification** (Section 10.4) and to `migrate-flows-jsx-to-slots` (which adds a `session-card-no-double-flow` regression test).
- [x] 7.2 **DEFERRED to manual verification** (Section 10.4) and to `migrate-flows-jsx-to-slots`.
- [x] 7.3 **DEFERRED to manual verification** (Section 10.4) and to `migrate-flows-jsx-to-slots`.

## 8. Spec deltas

- [x] 8.1 Spec deltas already authored in `openspec/changes/wire-plugin-registry-into-shell/specs/dashboard-plugin-loader/spec.md`. Main spec is updated by `openspec archive` (Section 10.5), not edited mid-implementation.
- [x] 8.2 `openspec validate wire-plugin-registry-into-shell --strict` → "Change is valid".

## 9. Documentation update

- [x] 9.1 Delegated to general-purpose subagent in caveman style. Updated `docs/file-index-client.md` (App.tsx row appended, new row for `generated/plugin-registry.tsx`) and `docs/file-index-plugins.md` (vite-plugin row appended).

## 10. Verification

- [x] 10.1 No dependency changes — workspace already installed.
- [x] 10.2 `npm run build` clean. `packages/client/src/generated/plugin-registry.tsx` overwritten (jj-plugin: 6 claims, flows-anthropic-bridge-plugin: 1 claim, flows-plugin: 0 claims (deferred), demo-plugin filtered as `fixture: true`). Switched runtime import in `vite.config.ts` from package-specifier to relative workspace path so vite's esbuild config-loader bundles the .ts source inline (the package ships raw .ts; package-specifier import hit ERR_MODULE_NOT_FOUND on internal `.js` re-imports).
- [x] 10.3 `npm test` — 4296 passed, 9 skipped, 0 failed (initial run had 1 failure: my own regression test asserted every entry had ≥1 claim, which broke against the deliberately-emptied flows entry. Loosened to "≥1 claim across all entries" — still catches a totally-unwired regression while tolerating per-plugin transitional empty-claims).
- [x] 10.4 `npm run dev` manual smoke test — **DEFERRED to user**. Acceptance criteria: open a jj workspace session → badge + action bar render once, in the slot-area below OpenSpec actions; settings panel shows JjPluginSettings + FlowsAnthropicBridgeSettings.
- [x] 10.5 `openspec archive wire-plugin-registry-into-shell` — **DEFERRED to user, post-merge**.
