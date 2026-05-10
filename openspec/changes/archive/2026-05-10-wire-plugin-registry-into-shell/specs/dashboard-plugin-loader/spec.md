## MODIFIED Requirements

### Requirement: Vite plugin generates a static plugin registry

The `vite-plugin-dashboard-plugins` SHALL generate `packages/client/src/generated/plugin-registry.tsx` at dev start and on every build. The generated file SHALL use **named imports** for each claimed component (not `import * as`) so that Vite tree-shakes unused exports from plugin packages.

The generated file SHALL be committed to source control under a `.gitignore` rule for the `generated/` directory and produced fresh on every build.

`packages/client/vite.config.ts` SHALL invoke `viteDashboardPluginsPlugin()` and include its result in the `plugins[]` array. Failure to do so means the generated file is never produced, regardless of the plugin's correctness. The invocation SHALL use a deferred / dynamic import so a fresh checkout (where `dashboard-plugin-runtime` is not yet built) does not break vite startup; in that fallback state the plugin is skipped and the registry stays at its committed-stub initial value.

#### Scenario: Generated file uses named imports

- **WHEN** a plugin claims `{ "slot": "session-card-badge", "component": "OpenSpecBadge" }`
- **THEN** the generated `plugin-registry.tsx` SHALL contain a named import like `import { OpenSpecBadge } from "@blackbelt-technology/openspec-plugin/client"`, not a wildcard `import *`.

#### Scenario: Unused exports tree-shaken from production bundle

- **WHEN** a plugin's client entry exports `Foo` and `Bar`, and only `Foo` is claimed in the manifest
- **THEN** the production bundle SHALL contain `Foo` and SHALL NOT contain `Bar` (asserted by a build artifact scan in the test suite).

#### Scenario: Manifest change regenerates registry and triggers HMR

- **WHEN** a plugin's `package.json#pi-dashboard-plugin` field is edited during `vite dev`
- **THEN** the Vite plugin SHALL detect the change, regenerate `plugin-registry.tsx`, and trigger an HMR update so the client picks up the new manifest without a full reload.

#### Scenario: Plugin source change does not regenerate registry

- **WHEN** a file inside a plugin package's `src/` is edited (no manifest change)
- **THEN** the Vite plugin SHALL NOT regenerate `plugin-registry.tsx`; HMR SHALL flow through Vite's normal module graph.

#### Scenario: vite.config.ts must invoke the plugin

- **WHEN** a workspace plugin manifest exists under `packages/<pkg>/package.json#pi-dashboard-plugin` AND `vite.config.ts` does not register `viteDashboardPluginsPlugin` in `plugins[]`
- **THEN** the generated `plugin-registry.tsx` SHALL remain at its committed-stub state with `PLUGIN_REGISTRY = []` after `vite build`
- **AND** the regression test `packages/client/src/__tests__/plugin-registry-populated.test.ts` SHALL fail (post-build) with a clear message identifying the missing wiring.

#### Scenario: Fresh checkout without runtime built

- **WHEN** `vite dev` is invoked on a clone where `packages/dashboard-plugin-runtime/dist/` does not exist yet
- **THEN** the dynamic import of `viteDashboardPluginsPlugin` SHALL fail silently and vite SHALL start with the committed-stub registry
- **AND** no error SHALL be logged to stderr beyond a single `[plugin-registry] runtime not built — registry empty` info message.

## ADDED Requirements

### Requirement: Shell consumes the generated plugin registry

The dashboard shell (`packages/client/src/App.tsx` or its successor entry component) SHALL import `PLUGIN_REGISTRY` from `./generated/plugin-registry` and populate the `SlotRegistry` instance passed to `<PluginContextProvider>` with every claim from every entry. Failure to do so means slot consumers in the shell render zero contributions even when the generated registry is populated.

#### Scenario: Empty registry produces empty slot consumers

- **WHEN** `PLUGIN_REGISTRY` is `[]` (committed stub state, fresh checkout, or runtime not built)
- **THEN** `<PluginContextProvider registry={_pluginRegistry}>` SHALL receive an empty registry
- **AND** every slot consumer (`<SettingsSectionSlot>`, `<SessionCardBadgeSlot>`, etc.) SHALL render zero contributions
- **AND** the shell SHALL render normally with all legacy direct imports intact (no error, no fallback UI required).

#### Scenario: Populated registry threads claims to slot consumers

- **WHEN** `PLUGIN_REGISTRY` contains `[{ manifest: { id: "demo", … }, claims: [{ slot: "settings-section", component: DemoSettings, tab: "general" }] }]`
- **THEN** `<SettingsSectionSlot tab="general">` SHALL render `<DemoSettings>` wrapped in the runtime's `SlotErrorBoundary`
- **AND** `<SettingsSectionSlot tab="servers">` SHALL render zero contributions (no claim for `tab: "servers"`).

#### Scenario: Co-tenancy with legacy direct imports

- **WHEN** the shell renders `<SessionCardBadgeSlot session={s}/>` AND a plugin claims `session-card-badge` for a component that the shell **also** imports directly via legacy JSX
- **THEN** the result is duplicate rendering of that component
- **AND** the migration plan SHALL remove the legacy direct import in the same change that populates the registry, OR keep the slot empty until the legacy import is removed in a follow-up
- **AND** a regression test SHALL verify no double-render exists for the four migrated cases (`FlowActivityBadge`, `SessionFlowActions`, `JjWorkspaceBadge`, `JjActionBar`).

#### Scenario: Registry populated only at module load

- **WHEN** the shell module first loads
- **THEN** the `_pluginRegistry` SHALL be populated synchronously from `PLUGIN_REGISTRY`
- **AND** subsequent edits to plugin source code during `vite dev` SHALL trigger HMR through vite's normal module graph (not via registry mutation)
- **AND** subsequent edits to plugin manifests SHALL trigger registry regeneration via the vite plugin, which produces a new `generated/plugin-registry.tsx` and HMR-replaces the App module.
