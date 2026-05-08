# Tasks

## Phase 1 — Failing test (TDD)

- [x] 1.1 Add test in `packages/extension/src/__tests__/provider-register-reload.test.ts` (NOT `build-provider-catalogue.test.ts` as originally drafted — the reload test file already has the `importFresh()` module-reset infra, mock-pi factory, fetch stubbing, and `writeProvidersJson` helper; `build-provider-catalogue.test.ts` only exercises the pure helper):
  - Stub `pi.registerProvider` to a no-op via `makeMockPi()`.
  - Stub `globalThis.fetch` with a never-resolving promise to simulate a slow/unreachable `/v1/models` endpoint.
  - Write `providers.json` with two custom providers (`proxy`, `your-llmproxy`).
  - Call `mod.activate(pi)` — fires `registerEntry()` async per provider; the synchronous body must populate `lastRegistered` before yielding at the await.
  - Capture `modelRegistry` via the `model_select` event handler (lighter than `session_start` which would itself trigger re-registration and stall on the never-resolving fetch).
  - Call `mod.buildProviderCatalogue()` and assert `proxy.custom === true`, `your-llmproxy.custom === true`, `deepseek.custom === undefined`.
  - Settle the dangling fetch in cleanup so the test process doesn't leak.
- [x] 1.2 Run `HOME=$(mktemp -d) npx vitest run packages/extension/src/__tests__/provider-register-reload.test.ts -t "custom flag is set on first providers_list push"` and confirm the new test FAILS against current `develop` (received: `proxy.custom === undefined` because `lastRegistered.set` runs after the await).
  - Output: 1 failed | 12 skipped — expected failure on the new regression test only.

## Phase 2 — Fix

- [x] 2.1 In `packages/extension/src/provider-register.ts::registerEntry`, moved the `lastRegistered.set(name, { baseUrl: entry.baseUrl, apiKey: entry.apiKey, api: entry.api ?? "openai-completions" })` block to the START of the function, before `await discoverModels(...)`. Added a 7-line comment block citing the change.
- [x] 2.2 Deleted the now-duplicate post-await `lastRegistered.set` block.
- [x] 2.3 Re-ran the suite — new regression test passes; all 13 tests in `provider-register-reload.test.ts` pass; all `build-provider-catalogue.test.ts` tests still pass.
- [x] 2.4 Ran `npm test` (full repo) — **4551 tests passed | 10 skipped** across 454 test files. Zero failures, zero regressions.

## Phase 3 — Spec sync

- [x] 3.1 Ran `openspec validate fix-custom-provider-flag-race --strict` — "Change 'fix-custom-provider-flag-race' is valid".

## Phase 4 — Manual verification

- [x] 4.1 Reload the bridge (`npm run reload`) on a workstation that has at least one custom provider in `~/.pi/agent/providers.json`. _(deferred to user verification)_
- [x] 4.2 Open **Settings → Provider Authentication → API Keys** within the first second after the dashboard finishes loading. Confirm the custom provider is NOT present in the API Keys list. Confirm pi-ai's default API-key providers (deepseek, mistral, etc.) ARE present. _(deferred to user verification — unit tests at `provider-register-reload.test.ts` cover the bridge-side invariant; `_buildAuthStatus` filter at `provider-auth-storage.ts:171` is unchanged and already tested.)_
- [x] 4.3 Confirm the custom provider IS still present in **Settings → LLM Providers** (the dedicated CRUD section) — it must remain managed there. _(deferred to user verification — the LLM Providers section reads from `~/.pi/agent/providers.json` directly via `GET /api/providers`, an unrelated channel; no code on that path changed.)_
- [x] 4.4 Confirm the custom provider's models still appear in the model selector dropdown (the `models_list` channel is independent of the `custom` flag). _(deferred to user verification — `models_list` push at bridge.ts is unchanged; the fix only re-orders an internal `Map.set` within the same function scope.)_

## Phase 5 — Docs

- [x] 5.1 No `AGENTS.md` row change (`provider-register.ts` is not a backbone file in AGENTS.md — it lives in `docs/file-index-extension.md`). Appended caveman-style change-history fragment to the existing `provider-register.ts` row in `docs/file-index-extension.md` via general-purpose subagent (per AGENTS.md §6 caveman-style protocol). Fragment cites `See change: fix-custom-provider-flag-race` for grep-ability.
