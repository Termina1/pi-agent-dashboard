## Why

After upgrading to pi 0.73.1 the dashboard fails to start with: "Cannot find pi's TypeScript loader (jiti). Is `@mariozechner/pi-coding-agent` or `@oh-my-pi/pi-coding-agent` installed?"

Pi 0.73.1's CHANGELOG explains: "Changed extension loading to use upstream `jiti` 2.7 instead of the `@mariozechner/jiti` fork." Pi no longer ships its own jiti fork — it depends on the bare-name upstream package. npm hoists `jiti` to `~/.pi-dashboard/node_modules/jiti/`, where pi finds it automatically via Node's normal resolution.

The dashboard's `resolveJitiImport` (and its sibling `resolveJitiFromAnchor`) hardcode a list of jiti package names to look up via `createRequire`:

```ts
const JITI_PACKAGES = ["@mariozechner/jiti", "@oh-my-pi/jiti"];
```

Both names are pi-fork-specific. Neither exists when pi is at 0.73.1+. The resolver tries both, fails both, throws the user-visible error.

The fix is one line: add `"jiti"` to the lookup list. Upstream jiti 2.7 ships at the same canonical layout (`<pkg>/lib/jiti-register.mjs`), so the existing `buildJitiRegisterUrl` helper handles it without modification.

## What Changes

- Add `"jiti"` (bare upstream name, no scope) to the `JITI_PACKAGES` array in `packages/shared/src/resolve-jiti.ts`. Both `resolveJitiImport` and `resolveJitiFromAnchor` consume this array.
- Order the lookup list so legacy fork names (`@mariozechner/jiti`, `@oh-my-pi/jiti`) are tried FIRST. This preserves the existing behaviour for users still on pi ≤ 0.73.0 and only falls through to the upstream package when neither fork is present. (Forward-compat is the default; backward-compat is preserved.)
- Update the file's docstring to mention upstream jiti as a supported provider, with a one-line note explaining the pi 0.73.1 transition.
- Add a unit test that mocks `createRequire` resolution to assert all three lookup names are tried in order.

Scope-limiting decisions:
- No changes to `buildJitiRegisterUrl`. The register-hook layout is identical across `@mariozechner/jiti` 2.x and upstream `jiti` 2.7.
- No changes to the consuming spawn / argv plumbing in `dashboard-server`. Once the resolver returns a valid `file://` URL, downstream code is jiti-version-agnostic.
- No changes to `tsx` fallback path (still triggers when ALL jiti providers fail to resolve).
- No changes to Electron's offline-cacache pin. The pinned pi version determines which jiti fork (if any) ships with it; the resolver now handles both worlds without re-pinning.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `dashboard-server`: the existing requirements that mandate the jiti resolver returns a `file://` URL are unchanged. A new scenario is added asserting upstream `jiti` (bare name) is supported alongside the two pre-0.73.1 fork names.

## Impact

**Touched code (~8 LOC):**
- `packages/shared/src/resolve-jiti.ts` — extend `JITI_PACKAGES` with `"jiti"`, update docstring.

**New test (~30 LOC):**
- `packages/shared/src/__tests__/resolve-jiti.test.ts` — extend existing test file with assertions covering the new lookup order. Use `createRequire`-style mocks; do NOT depend on the live `~/.pi-dashboard/node_modules/...` layout.

**Untouched:**
- `buildJitiRegisterUrl` — already handles upstream jiti by virtue of identical filesystem layout.
- All consumers (`dashboard-server` spawn paths, `electron-shell` server-lifecycle.ts, `cli.ts`).
- Existing `pi-version-skew` / `pi-core-checker` plumbing.

**Risk surface:**
- A user with BOTH `@mariozechner/jiti` AND `jiti` installed (mid-migration scenario) gets the legacy fork resolved — same as today. No regression.
- A user with only `jiti` (post-0.73.1) gets a working resolver. Fixes the blocking startup error.
- A user with neither (pi not installed at all) gets the same "Cannot find pi's TypeScript loader" error as before. Behaviour preserved at the failure boundary.
