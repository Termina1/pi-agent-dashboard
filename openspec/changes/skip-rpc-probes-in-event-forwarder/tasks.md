## 1. Snapshot helpers (pure functions)

- [ ] 1.1 Add `snapshotForRpcDetection(data: unknown): RpcSnapshot` to `packages/extension/src/bridge.ts` (or a new `packages/extension/src/rpc-shape.ts` if it grows past ~30 lines). For `null`/`undefined`/non-object → `{ kind: "scalar", value }`. For object → `{ kind: "object", keys: Object.keys(data).sort().join("|"), hash: shallowJsonHash(data) }`.
- [ ] 1.2 Add `shallowJsonHash(data: object): string` — `JSON.stringify` over own enumerable properties, capped at 4096 chars (truncate suffix `"…<TRUNC>"`); circular-safe via `try/catch` falling back to key-set hash.
- [ ] 1.3 Add `equalSnapshot(a: RpcSnapshot, b: RpcSnapshot): boolean` — strict equality on `kind`, `value`/`keys`/`hash`.
- [ ] 1.4 Add `KNOWN_RPC_CHANNELS` constant array `["flow:list-flows", "flow:role-get-all", "flow:resolve-model", "flow:get-available-models"]` with doc-comment explaining: this is documentation, NOT a runtime denylist. Used only by the lint test in §4.
- [ ] 1.5 Unit-test `snapshotForRpcDetection` + `equalSnapshot` in `packages/extension/src/__tests__/rpc-shape.test.ts`: scalar identity, object key-add, object value-change, nested-object identity (same reference → equal even if deep-mutated, documented limitation), 4 KB cap behavior, circular reference fallback.

## 2. Wrap-point integration in `bridge.ts`

- [ ] 2.1 Locate the wrapper at `packages/extension/src/bridge.ts:907–920`. Add a `// see change: skip-rpc-probes-in-event-forwarder` header comment + doc-block citing the pi-core synchronous-dispatch invariant.
- [ ] 2.2 Replace the body with: listener-count fast-path → snapshot before → call `origEventsEmit` → snapshot after → forward only if `!mutated`. Original `emit` SHALL always be called regardless of forwarding decision (preserve existing invariant).
- [ ] 2.3 Add `warn-once` (module-scoped `let warnedAsync = false`) when `origEventsEmit` returns a thenable. Message: `"[dashboard] pi.events.emit returned a Promise — RPC-shape detection assumes sync dispatch; emissions may leak"`. Use `console.warn`.
- [ ] 2.4 Wrap snapshot calls in `try/catch`; on throw, fall back to "forward conservatively" (no skip). Failure to detect RPC must never break legitimate event delivery.
- [ ] 2.5 Verify `listenerCount` typeof-guard: if `typeof pi.events.listenerCount !== "function"`, skip the fast-path and use the snapshot path unconditionally.

## 3. Heuristic correctness tests

- [ ] 3.1 Create `packages/extension/src/__tests__/event-forwarder-rpc-skip.test.ts`. Build a fake `pi.events` with `on`/`emit`/`listenerCount` and a fake `connection` capturing `event_forward` sends.
- [ ] 3.2 Test: empty probe + handler that writes `data.flows = [...]` → handler runs, NO `event_forward` sent, original behavior preserved (probe.flows populated).
- [ ] 3.3 Test: pre-populated probe `{ role, modelId }` + handler that adds `data.success = true` → NO `event_forward` sent.
- [ ] 3.4 Test: broadcast `emit("flow:agent-started", { agent: "x" })` + read-only listener → `event_forward` sent with mapped name.
- [ ] 3.5 Test: broadcast `emit("custom:ping", {})` with NO listeners → `event_forward` sent (listener-count zero fast-path).
- [ ] 3.6 Test: broadcast `emit("custom:ping", {})` with a listener that does NOT mutate → `event_forward` sent.
- [ ] 3.7 Test: non-object data `emit("legacy:string", "hello")` → `event_forward` sent.
- [ ] 3.8 Test: `null` data → `event_forward` sent.
- [ ] 3.9 Test: `sessionReady === false` → no `event_forward` regardless of mutation (existing invariant).
- [ ] 3.10 Test: handler throws → `origEventsEmit` re-throws (preserved); no `event_forward` sent.
- [ ] 3.11 Test: handler returns Promise (simulated async dispatch) → `warn-once` fires; emission forwarded conservatively (no skip). Subsequent async emission does NOT re-warn.
- [ ] 3.12 Test: `listenerCount` absent on `pi.events` → falls back to snapshot path; behavior identical to §3.2–3.6.
- [ ] 3.13 Test: snapshot helper throws (via JSON.stringify on a value with a throwing getter) → forwarded conservatively (no skip).

## 4. Anti-pattern lint test

- [ ] 4.1 Create `packages/extension/src/__tests__/no-broadcast-payload-mutation.test.ts`. Use `fs.readFileSync` over `packages/extension/src/*.ts` (excluding `__tests__` + `rpc-shape.ts`), parse `pi.events.on("<channel>", (<param>) => { … })` callsites with a small regex / TS AST walker (prefer `typescript` package's `forEachChild`).
- [ ] 4.2 For each handler, scan body for assignments to the first parameter's identifier (`<param>.something = …`, `<param>["key"] = …`, `Object.assign(<param>, …)`).
- [ ] 4.3 Allowlist: handlers whose channel literal is in `KNOWN_RPC_CHANNELS` (RPC handlers are EXPECTED to mutate). All other handlers SHALL NOT mutate.
- [ ] 4.4 Failing test message: `"<file>:<line>: handler for '<channel>' mutates its payload — broadcast handlers must be read-only. If this is an RPC handler, add the channel to KNOWN_RPC_CHANNELS in bridge.ts."`
- [ ] 4.5 Run the test against the current codebase and confirm it passes (RPC handlers are already in the allowlist; no broadcast handlers should mutate).

## 5. Documentation

- [ ] 5.1 Update `openspec/specs/catch-all-event-forwarding/spec.md` per the deltas in `specs/catch-all-event-forwarding/spec.md`.
- [ ] 5.2 Add a one-line row to `docs/file-index-extension.md` for `bridge.ts` change-history (append): `bridge.ts — see change: skip-rpc-probes-in-event-forwarder (RPC-shape filter on emit wrapper)`. Delegate the docs/ edit to a general-purpose subagent per AGENTS.md "Documentation Update Protocol", caveman style.
- [ ] 5.3 If `rpc-shape.ts` is added as a separate file, add a row to `docs/file-index-extension.md` describing its purpose (caveman style, ≤ 200 chars). Same delegation rule.

## 6. Verification

- [ ] 6.1 Run `npm test -- packages/extension 2>&1 | tee /tmp/rpc-skip-test.log` and confirm all new tests pass + no existing extension tests regress.
- [ ] 6.2 Run `npm run reload:check` (typecheck + reload) and confirm no TypeScript errors.
- [ ] 6.3 Manual smoke: open dashboard, run a session, check `MemoryEventStore` (via `/api/sessions/:id/events`) for `flow:list-flows` / `flow:role-get-all` event types — should be absent for new sessions started after reload. Existing sessions retain their pre-reload backlog (acceptable per migration story).
- [ ] 6.4 Manual smoke: trigger a flow run + a role change + a model resolve from the dashboard — confirm UI behavior is unchanged (flows list populates, roles save, model picker shows available models).
- [ ] 6.5 Run `openspec validate skip-rpc-probes-in-event-forwarder --strict` and resolve any spec-format complaints.
