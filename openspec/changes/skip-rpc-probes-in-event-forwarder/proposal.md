## Why

The bridge's `pi.events.emit` catch-all wrapper (`packages/extension/src/bridge.ts:907–920`) forwards every EventBus emission to the dashboard as `event_forward`. That was a deliberate choice to support custom-extension events without bridge updates — but it conflates two semantically distinct uses of the same API:

1. **Broadcast** — `emit("flow:agent-started", { agent, model, … })` — fire-and-forget, semantically interesting, SHOULD be forwarded.
2. **Synchronous RPC** — `emit("flow:list-flows", probe)` followed by `probe.flows` — handlers mutate the argument as a return channel, semantically internal, SHOULD NOT be forwarded.

A single observed session emits ~125 RPC-shaped events (98× `flow:list-flows`, 27× `flow:role-get-all`) that round-trip to the server, persist into `MemoryEventStore`, replay to every reconnecting browser, and surface as `rawEvent` chat rows in the client reducer's default branch. The same pattern exists for `flow:resolve-model` and `flow:get-available-models` in `provider-register.ts`, and any future extension that uses `emit` as RPC will leak the same way.

The naive fix is to denylist the four known channels in the bridge. We reject that because it hardcodes pi-flows + provider-register knowledge into the bridge and silently breaks again the next time someone introduces an RPC-shape probe.

## What Changes

- **Mutation-shape heuristic in the bridge wrapper**: snapshot the data argument before calling `origEventsEmit`, compare after. If handlers mutated it (key set or scalar value changed), treat as RPC and skip `event_forward`. Forward only emissions whose data argument is unchanged.
- **Listener-count guard**: if `pi.events.listenerCount(channel) === 0`, the emission cannot be RPC (no one wrote to the probe), so forward unconditionally. This avoids dropping broadcast events that pass `{}` payload.
- **Synchronous-emit assertion**: pi-core's EventBus dispatches handlers synchronously. The wrapper SHALL document this dependency and fail loudly (warn-once + forward conservatively) if a future pi-core release changes that contract.
- **Anti-pattern lint hook**: add a comment + repo-lint test asserting no broadcast handler in `packages/extension/src/` mutates its event payload, so the heuristic stays sound.
- No protocol changes. No config changes. No client changes. No pi-core changes.

## Capabilities

### Modified Capabilities
- `catch-all-event-forwarding`: the EventBus intercept SHALL skip `event_forward` for emissions whose data argument was mutated by synchronous handlers (RPC-shape detection). Original `emit` SHALL still be called. Listener-count zero SHALL force forwarding (broadcast fallback).

## Impact

Affected code:
- `packages/extension/src/bridge.ts` — wrap probe site only; add `snapshotForRpcDetection` + `wasMutated` helpers; integrate listener-count guard; warn-once on async-handler suspicion.
- `packages/extension/src/__tests__/event-forwarder-rpc-skip.test.ts` (new) — table-driven cases covering: empty probe filled by handler (skip); pre-populated probe scalar mutated (skip); broadcast unchanged (forward); broadcast with no listeners + empty payload (forward); broadcast with `{}` payload + listener that does NOT mutate (forward); non-object data (forward).
- `packages/extension/src/__tests__/no-broadcast-payload-mutation.test.ts` (new) — repo-lint scanning bridge-side `pi.events.on(...)` handlers for assignments to the `data` parameter; whitelists the known RPC channels documented in `design.md`.

No new dependencies. No breaking changes — purely a forwarding filter; persisted sessions and replay paths are unaffected (they continue to load any historical RPC events that were already stored).

Migration / rollback:
- **Migration**: none. The filter is server-agnostic; old servers continue to receive whatever the bridge sends. New bridges send less.
- **Rollback**: revert the wrapper change. No data migration. No client changes to undo.
- **Compatibility**: per-session `rawEvent` rows already persisted from earlier bridges remain in `MemoryEventStore`/sidecar JSONL until the LRU evicts them. No cleanup task — they're harmless and self-extinguish.

Long-term follow-up (out of scope, captured in design.md): propose `pi.events.request(channel, input)` to pi-core as a distinct API for RPC-shape calls. Once adopted, the heuristic can be retired.
