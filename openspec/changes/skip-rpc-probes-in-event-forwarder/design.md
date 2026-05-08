## Context

The bridge wraps `pi.events.emit` to forward every EventBus emission to the dashboard server. This was deliberate — see `openspec/specs/catch-all-event-forwarding/spec.md` — and supports third-party extensions emitting custom events without a bridge update.

The wrap was added before pi-flows started using `pi.events.emit(channel, probe)` as a synchronous RPC mechanism. Today both shapes share the API:

```ts
// Broadcast — semantically an event
pi.events.emit("flow:agent-started", { agent, model, turnId });

// RPC probe — semantically a function call
const probe: any = {};
pi.events.emit("flow:list-flows", probe);
return probe.flows ?? [];
```

The wrapper can't tell them apart, so it forwards both. A single session leaks ~125 RPC events into the dashboard's event store, replay pipeline, and chat-row renderer.

## Goals

- Stop forwarding RPC-shape emissions without enumerating channel names in the bridge.
- Preserve the catch-all guarantee for broadcast events from unknown extensions.
- Keep the wrapper cheap (every `pi.events.emit` call goes through it).
- Fail loud, not silent, if pi-core ever changes the synchronous-handler contract.

## Non-Goals

- Modifying pi-core to add a separate RPC API (right long-term answer; tracked as follow-up).
- Migrating existing RPC callsites in pi-flows / provider-register to a new API.
- Cleaning up historical `rawEvent` rows already persisted by older bridges.

## Decisions

### D1: Use mutation-shape heuristic, not channel allowlist or marker convention

Four candidates were considered:

| Option | Hardcodes channels? | Needs upstream cooperation? | Deterministic? |
|---|---|---|---|
| A. Mutation heuristic | no | no | heuristic |
| B. Marker on data (`__rpc: true`) | no | yes (every probe site opts in) | deterministic |
| C. Separate `pi.events.request` API | no | yes (pi-core change) | deterministic |
| D. Allowlist of broadcast names | inverted | no | deterministic |

A wins for the short term: zero coordination, no channel coupling, catches today's leak and any future RPC-shape probe automatically. C is the long-term right answer but out of scope.

### D2: Detect mutation by snapshotting before/after `origEventsEmit`

pi-core's EventBus dispatches handlers synchronously. After `origEventsEmit` returns, any RPC handler has already written to the probe.

```ts
pi.events.emit = (channel, data) => {
  const before = snapshotForRpcDetection(data);
  origEventsEmit(channel, data);
  const after  = snapshotForRpcDetection(data);
  const mutated = !equalSnapshot(before, after);
  if (sessionReady && isActive() && !mutated && shouldForward(channel, data)) {
    forward(channel, data);
  }
};
```

Snapshot strategy:
- `null` / `undefined` / non-object → snapshot is the value itself; never "mutated".
- Object → `{ keys: Object.keys(data).sort().join("|"), valuesHash: shallowValueHash(data) }`. Detects added/removed keys and changed scalar values. Does NOT detect deep mutation of nested objects, which is acceptable: RPC probes mutate top-level fields by convention (`probe.flows = [...]`, `probe.success = true`, `probe.roles = {...}`).
- `shallowValueHash` is `JSON.stringify` of own enumerable properties, capped at 4 KB. For the four known probe shapes, payloads are < 200 bytes; cost is negligible.

### D3: Listener-count guard prevents false-skip on broadcast `{}` payloads

If a broadcast emits `emit("custom:ping", {})` and no handler mutates it, snapshot is unchanged → forward (correct). If no handler is registered at all, the emission cannot be RPC by definition; force-forward without snapshotting:

```ts
if (typeof pi.events.listenerCount === "function" && pi.events.listenerCount(channel) === 0) {
  origEventsEmit(channel, data);
  forward(channel, data);
  return;
}
```

This protects custom-extension events whose listener registration is dashboard-side only (e.g. ext-ui channels handled by the bridge itself). The `typeof` guard exists because `listenerCount` is not part of the formal pi.events API contract; if absent, fall through to the snapshot path (slightly more conservative).

### D4: Anti-pattern lint, not runtime check

The heuristic has one false-skip mode: a broadcast handler that mutates its payload. That's an anti-pattern (event payloads should be immutable), and we lint for it rather than try to detect it at runtime.

`packages/extension/src/__tests__/no-broadcast-payload-mutation.test.ts` scans bridge-side `pi.events.on(...)` handler bodies for assignments to the handler's first-argument identifier. RPC channels are documented in a constant (`KNOWN_RPC_CHANNELS = ["flow:list-flows", "flow:role-get-all", "flow:resolve-model", "flow:get-available-models"]`) and whitelisted; new entries require an explicit doc-comment.

This puts the burden on whoever writes a new RPC-shape handler to either (a) follow the convention and let the heuristic catch them, or (b) update the lint whitelist consciously.

### D5: Synchronous-emit assumption + warn-once safeguard

If pi-core ever switches to async dispatch, the heuristic silently degrades — RPC probes leak again. We protect with:

1. A doc-block in `bridge.ts` near the wrapper citing the pi-core invariant.
2. A `warn-once` triggered when `origEventsEmit` returns a Promise (which it shouldn't):
   ```ts
   const result = origEventsEmit(channel, data);
   if (result && typeof (result as any).then === "function") {
     warnOnce("pi.events.emit returned a Promise — RPC-shape detection assumes sync dispatch");
   }
   ```
3. A pi-core version pin documented in the wrapper comment so future bumps trigger a review.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Broadcast handler mutates payload (anti-pattern) | medium | D4 lint test |
| pi-core switches to async dispatch | low (no signal) | D5 warn-once + version pin |
| RPC probe with no listener leaks | low | acceptable — event has no semantic content; visible as a single `rawEvent` row, not 98× |
| Snapshot cost on hot path | low | shallow JSON.stringify, < 4 KB cap, ~µs per emission |
| `listenerCount` not implemented | low | `typeof` guard falls through to snapshot path |
| Deep-mutation RPC (handler mutates `data.nested.field`) | low | none in current callsites; documented as forbidden convention |

## Alternatives Considered

- **B. `__rpc: true` marker**: rejected because it requires every probe site (pi-flows, provider-register, third-party) to opt in. Bridge cannot enforce. Future drift inevitable.
- **C. `pi.events.request` API**: right long-term answer, but cross-package coordination + migration of every callsite. Filed as follow-up after this change lands.
- **D. Hardcoded allowlist of broadcast names**: violates the original "support unknown extensions" goal of the catch-all forwarder.
- **Skip channels matching a regex (`/^flow:.*-(flows|roles|models)$/`)**: brittle. Regex maintenance is the same problem as a denylist with extra steps.

## Open Questions

- None blocking. Long-term migration to `pi.events.request` is a separate proposal once this change has shipped and proven the heuristic stable in production.
