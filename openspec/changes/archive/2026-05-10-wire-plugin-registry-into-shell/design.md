# Design

## Decision 1: Dynamic-import the vite plugin

**Why:** A static `import { viteDashboardPluginsPlugin } from "@blackbelt-technology/dashboard-plugin-runtime/vite-plugin"` at the top of `vite.config.ts` evaluates *before* `npm install` finishes on a fresh checkout, breaking `npm install → npm run dev` for new contributors. The existing comment in `vite.config.ts` already telegraphs the constraint.

**Shape:**

```ts
// packages/client/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

async function loadPluginRegistryVitePlugin() {
  try {
    const mod = await import(
      "@blackbelt-technology/dashboard-plugin-runtime/vite-plugin"
    );
    return mod.viteDashboardPluginsPlugin?.();
  } catch {
    // Runtime not built yet (fresh checkout). Skip; registry stays empty.
    return null;
  }
}

export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
    ...(await loadPluginRegistryVitePlugin().then((p) => (p ? [p] : []))),
  ],
  // … rest unchanged
}));
```

**Alternatives rejected:**

- *Static import + try/catch around `defineConfig` body* — `import` is hoisted, can't catch resolution failure at runtime.
- *Add `dashboard-plugin-runtime` as a hard `dependencies` of `client`* — already a dependency; the failure mode is "not yet built", not "not installed". Dynamic import handles both.

## Decision 2: Shell builds registry from generated file at module load

**Why:** The generated file is a static module — importing it once at module-load time gives a stable registry for the whole process. Avoids React effects and runtime fetches.

**Shape:**

```tsx
// packages/client/src/App.tsx
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
// PLUGIN_REGISTRY is generated at build time by viteDashboardPluginsPlugin.
// Empty array on a fresh checkout (file doesn't exist) — handled by a
// generated stub committed alongside .gitignore, OR by a try/catch import.
import { PLUGIN_REGISTRY } from "./generated/plugin-registry";

const _pluginRegistry = createSlotRegistry();
for (const entry of PLUGIN_REGISTRY) {
  for (const claim of entry.claims) {
    _pluginRegistry.register(entry.manifest, claim);
  }
}
```

**Alternatives rejected:**

- *useEffect + dynamic import* — adds an async boundary for no benefit; slot consumers would render empty on first paint.
- *Read raw manifests at runtime* — duplicates the vite plugin's job and breaks tree-shaking (the whole reason the vite plugin emits **named imports**).

## Decision 3: `generated/.gitignore` stub keeps the file path resolvable on fresh clones

**Why:** A static `import "./generated/plugin-registry"` against a path that doesn't exist breaks `tsc` and `vite dev`. Two options:

1. **Stub committed.** Commit `packages/client/src/generated/plugin-registry.tsx` with `export const PLUGIN_REGISTRY = [];` and a `// GENERATED — overwritten on build` header. The vite plugin overwrites on dev/build. Simple; the file is almost always overwritten anyway.

2. **Dynamic import wrapper.** Wrap the import in `try { … } catch { return []; }`. Adds complexity to App.tsx for a one-time fresh-clone state.

Decision: **Option 1.** Commit a stub with `PLUGIN_REGISTRY = []`. The `.gitignore` rule only ignores changes in CI runs, not the stub itself — so contributors clone and the file is present.

**Note:** The existing `dashboard-plugin-loader` spec says the generated dir is *"committed to source control under a `.gitignore` rule for the `generated/` directory"* — this reads as "the directory is gitignored except for an explicit stub". We honor that: ignore everything except the stub via `!plugin-registry.tsx` exception.

```
packages/client/src/generated/.gitignore
---
*
!.gitignore
!plugin-registry.tsx
```

## Decision 4: Don't remove legacy direct imports in this change

**Why:** Co-tenancy is the safety guarantee. Removing the direct `<FlowActivityBadge>` import from `SessionCard.tsx` while wiring the slot is two changes in one — easy to break if the slot doesn't activate (gate predicate, manifest typo, plugin disabled in config).

But — wiring the slot AND keeping the direct import causes **duplicate rendering** for any plugin that has both. Two flow badges on every flow session is a visible regression.

**Resolution:** Remove the direct imports for the **two specific co-tenant pairs** (`FlowActivityBadge`, `SessionFlowActions`) AND the jj-plugin's `JjWorkspaceBadge` + `JjActionBar` in this change. Every other slot claim today either has no co-tenant direct import (newly added: demo-plugin, flows-anthropic-bridge-plugin) or hasn't been migrated yet (still pure direct imports — slot claim added by extraction proposals but not yet rendered). For the latter group, keeping the direct import is correct: the slot renders nothing until the rest of the migration ships.

**Lint guard:** Update `packages/client/src/__tests__/no-jsx-slot-nullish-fallback.test.ts` to add `App.tsx` and `SessionCard.tsx` to `SCAN_FILES` (already covered for `App.tsx`; verify `SessionCard.tsx` is included).

**Visual regression:** Snapshot `SessionCard` renders for (a) flow session, (b) jj session, (c) plain session. Before/after this change SHALL produce identical DOM (one badge, one action bar each).

## Decision 5: Skip-able regression test for the populated registry

**Why:** `npm test` does not run `npm run build` first. CI does. Asserting the generated file is non-empty in `npm test` would force every contributor to build before testing — large regression.

**Resolution:** Test detects absence of the generated stub *content* (default `[]` vs. populated) and:

- If `[]` (stub state) → `test.skip("registry not built")`. Emits a vitest skip with the reason.
- If populated → assert at least one entry has a claim slot in the known set, and that the manifest id matches an actual workspace package.

This keeps the test running where it matters (CI, post-build) without breaking developer flow.
