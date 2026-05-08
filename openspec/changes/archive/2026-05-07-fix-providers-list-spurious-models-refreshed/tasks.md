# Tasks

## Phase 1 — Cache cumulatively gated on content change

- [x] 1.1 In `packages/server/src/provider-catalogue-cache.ts`, add a private `catalogueEqual(a, b)` helper that performs an order-sensitive deep equality check on two `ProviderInfo[]` arrays (compares every documented field on every entry, including `custom`).
- [x] 1.2 Change `setCatalogueForSession(sessionId, providers)` to compute `changed = !catalogueEqual(prev, providers)`, set `bySession.set(sessionId, providers)` unconditionally, set `latest = providers` only when `changed === true`, and return `{ changed }`.

## Phase 2 — Gate the broadcast

- [x] 2.1 In `packages/server/src/event-wiring.ts` (line 628), change the `providers_list` handler to capture the `{ changed }` return value from `setCatalogueForSession` and call `browserGateway.broadcastToAll({ type: "models_refreshed" })` ONLY when `changed === true`. Add an explanatory comment block citing the change name.

## Phase 3 — Tests

- [x] 3.1 Add 9 unit tests in `packages/server/src/__tests__/provider-catalogue-cache.test.ts` under a `describe("setCatalogueForSession `changed` signal", ...)` block:
  - first write reports `changed=true`
  - identical re-push (same reference) reports `changed=false`
  - identical re-push (fresh array reference, deep-equal contents) reports `changed=false`
  - length change reports `changed=true`
  - any field flip on any entry reports `changed=true`
  - order change reports `changed=true`
  - `custom` flag flip reports `changed=true`
  - cache value is updated regardless of `changed` signal
  - `latestSnapshot` is preserved when a no-op write to an older session happens after a real change to a newer session
- [x] 3.2 Extend `packages/server/src/__tests__/event-wiring-providers-list.test.ts` with a regression test that opens a real browser WS to the test server, sends three `providers_list` payloads from a fake bridge (first new, second identical, third with flipped `custom` flag), and asserts the count of `models_refreshed` messages received by the browser is exactly `1, 0, 1` respectively.

## Phase 4 — Verification

- [x] 4.1 Run targeted suite: `HOME=$(mktemp -d) npx vitest run packages/server/src/__tests__/provider-catalogue-cache.test.ts packages/server/src/__tests__/event-wiring-providers-list.test.ts` → all 16 tests pass (10 existing + 9 new + 1 new e2e — minus minor consolidation = 16).
- [x] 4.2 Run full repo: `npm test` → 4561 passed | 10 skipped, 0 failures.
- [x] 4.3 Live verification in agent-browser against a server running the fix: navigate `model-selector-fix → fix-local-electron → model-selector-fix` (the previously bug-triggering sequence). Result: every visit shows `disabled: false`, `hasChevron: true`, correct model. Same for cycles through `base` and back. Bug eliminated.

## Phase 5 — Spec sync

- [x] 5.1 Run `openspec validate fix-providers-list-spurious-models-refreshed --strict` and resolve any errors.

## Phase 6 — Docs

- [x] 6.1 Append caveman-style change-history annotation to the existing `provider-catalogue-cache.ts` row in `docs/file-index-server.md` via general-purpose subagent (per AGENTS.md §6 caveman-style protocol).
- [x] 6.2 Append caveman-style change-history annotation to the existing `event-wiring.ts` row in `docs/file-index-server.md` via the same subagent.
