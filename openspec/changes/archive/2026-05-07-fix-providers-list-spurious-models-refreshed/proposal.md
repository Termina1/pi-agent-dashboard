# Fix: routine `providers_list` arrival triggers spurious `models_refreshed` broadcast

## Why

`packages/server/src/event-wiring.ts:628` broadcasts `models_refreshed` to
**every** browser whenever a `providers_list` message arrives from any
bridge — regardless of whether the catalogue contents actually changed.

`subscription-handler.ts:141` asks for `request_providers` on every
browser subscribe. The bridge responds with `providers_list`. So the
sequence is:

```
   browser navigates to session A
     → subscribe(A) + request_models(A) + request_providers(A) (server)
     → bridge responds with models_list(A) + providers_list(A)
     → server: setCatalogueForSession(A) + broadcastToAll(models_refreshed)
     → client: setModelsMap(new Map())   // ← WIPES every session's models
              + send request_models(selectedSessionIdRef.current)
     → bridge for A re-responds with models_list(A) → modelsMap[A] populated ✓

   browser navigates to session B (some time later)
     → subscribe(B) + request_models(B) + request_providers(B)
     → bridge for B responds with models_list(B) + providers_list(B)
     → server: setCatalogueForSession(B) + broadcastToAll(models_refreshed)
     → client: setModelsMap(new Map())   // ← WIPES A's models AGAIN
              + send request_models(B)
     → modelsMap[B] populated ✓
     → modelsMap[A] = undefined ❌

   browser navigates BACK to session A
     → App.tsx auto-subscribe effect:
         if (selectedId && !subscribedRef.current.has(selectedId) && status === "connected")
           subscribedRef.current.add(selectedId);
           send subscribe(selectedId);
           if (!modelsMap.has(selectedId)) send request_models(selectedId);
       But subscribedRef.current.has(A) is TRUE (from the first visit),
       so the effect SKIPS the subscribe AND the request_models.
     → modelsMap[A] stays undefined
     → ModelSelector receives `models={undefined}` → hasModels=false
     → button rendered `disabled=""`, muted, no chevron
     → user sees a dead model selector for a session they previously used ❌
```

The bug reproduces deterministically with the sequence
`session A → session B → back to A`. Confirmed live in the browser:
the second visit to A renders `<button disabled="" class="… text-muted">…</button>`
with no chevron icon. Clicking the disabled button is a no-op (React
disables the click handler when `disabled={true}`).

The over-aggressive broadcast was a regression introduced by
`replace-hardcoded-provider-lists` (commit `3a6d39a`, May 5). The
`models_refreshed` broadcast is genuinely needed when **credentials
change** (the spec's pinned scenario in
`openspec/specs/provider-auth-server/spec.md` line 147) — that path
already fires from `provider-auth-routes.ts:92` and
`provider-routes.ts:106`. The bridge's response to the resulting
`credentials_updated` round-trip carries a **changed** catalogue, so
gating the `event-wiring.ts` site on actual content change preserves
the spec contract while killing the spurious global wipes.

Routine bridge state-syncs (every browser subscribe, every
`session_register`, every reconnect, every fork/resume) re-send
identical payloads — those are exactly the cases where the broadcast
must not fire.

## What Changes

- `packages/server/src/provider-catalogue-cache.ts::setCatalogueForSession`
  SHALL return `{ changed: boolean }` based on a deep-equality check
  against the previously-cached payload for that session.
- `packages/server/src/event-wiring.ts` SHALL only broadcast
  `models_refreshed` when `setCatalogueForSession` returns
  `changed === true`.
- The `latestSnapshot` reference SHALL only update when content
  changes — a no-op re-push for an old session must not clobber a more
  recent push from a different session as "latest".
- The catalogue cache itself SHALL still update unconditionally
  (replacing the entry with a fresh array reference is harmless and
  keeps memory pressure bounded).

## Capabilities

### Modified Capabilities

- `provider-auth-server`: amend the "Credentials updated triggers
  catalogue refresh" requirement to clarify that the
  `models_refreshed` broadcast originating from the catalogue-arrival
  path SHALL be gated on actual content change. The credential-write
  path's direct broadcast (provider-auth-routes.ts) is unchanged and
  still mandatory.

## Impact

- **Code**: ~25 lines added to `provider-catalogue-cache.ts`
  (deep-equality helper + return type), 5-line edit at
  `event-wiring.ts:628`.
- **Tests**: 9 new unit tests in `provider-catalogue-cache.test.ts`
  covering the `changed` signal across identity, deep-equality, length,
  field-flip, order-flip, custom-flag-flip, and latestSnapshot
  invariants. 1 new end-to-end test in
  `event-wiring-providers-list.test.ts` asserting the broadcast is
  emitted exactly once for the first push, zero times for an identical
  re-push, and once again for a payload with a flipped `custom` flag.
- **Protocol**: no change. `models_refreshed` payload unchanged. Wire
  format unchanged.
- **Migration**: none. In-memory cache; takes effect on next process
  start.
- **Risk**: very low. The deep-equality check is order-sensitive, which
  matches the bridge's deterministic catalogue construction
  (`_buildProviderCatalogue` builds via a stable iteration over
  `Set<string>` of provider ids). If a future bridge change introduces
  non-determinism in the order, the regression would be a HARMLESS
  extra broadcast (which the previous behavior already did
  unconditionally), not a missed broadcast.
- **Out of scope**: the App.tsx `subscribedRef` gating itself is left
  unchanged. The right architectural fix is to make `models_refreshed`
  precise enough that the gate doesn't matter; this proposal does
  exactly that. A defensive client-side change ("re-request models
  whenever modelsMap is missing the selected entry, regardless of
  subscribedRef") could be added later as belt-and-suspenders, but is
  not necessary to close the user-visible bug.
- **Out of scope**: the `Bug A` race fixed by
  `fix-custom-provider-flag-race` is independent. Both fixes are
  necessary; neither subsumes the other.
