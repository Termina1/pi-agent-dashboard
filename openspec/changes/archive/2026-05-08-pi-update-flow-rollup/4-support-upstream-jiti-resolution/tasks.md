## 1. Update the resolver

- [x] 1.1 In `packages/shared/src/resolve-jiti.ts`, extend `JITI_PACKAGES` from `["@mariozechner/jiti", "@oh-my-pi/jiti"]` to `["@mariozechner/jiti", "@oh-my-pi/jiti", "jiti"]`. Forks first, upstream last.
- [x] 1.2 Update the file-level docstring to mention upstream `jiti` 2.7 as a supported provider, with a one-line note: "pi 0.73.1+ uses upstream `jiti` instead of the fork".
- [x] 1.3 Verify `buildJitiRegisterUrl` works against upstream jiti's `lib/jiti-register.mjs` path (already verified manually — upstream jiti 2.7 ships the same layout).

## 2. Tests

- [x] 2.1 In `packages/shared/src/__tests__/resolve-jiti.test.ts`, add tests asserting all three names are tried in order. Use a stubbed `createRequire` (test seam — pass via dependency injection if not already available, or wrap `resolveJitiImport`'s `createRequire` call to make it injectable for tests). Tests MUST NOT depend on the live `~/.pi-dashboard/node_modules/...` layout — use mocked require/resolve only.
- [x] 2.2 Test: `@mariozechner/jiti` resolvable → returns its register URL, never queries the others.
- [x] 2.3 Test: only `jiti` (upstream) resolvable → returns its register URL.
- [x] 2.4 Test: nothing resolvable → throws with the existing error message including both `@mariozechner/pi-coding-agent` and `@oh-my-pi/pi-coding-agent` mentions.
- [x] 2.5 Test: parallel coverage for `resolveJitiFromAnchor` — upstream-only anchor returns a non-null URL.

## 3. Verify

- [x] 3.1 `HOME=$(mktemp -d) npx vitest run packages/shared/src/__tests__/resolve-jiti.test.ts` — all green.
- [x] 3.2 `npm run lint` — no new TypeScript errors.
- [ ] 3.3 Manual smoke: with the bug-reproducing pi 0.73.1 install (`@mariozechner/jiti` absent, upstream `jiti` present), restart the dashboard and verify it boots without the "Cannot find pi's TypeScript loader" dialog. (Deferred — requires running dashboard.)
