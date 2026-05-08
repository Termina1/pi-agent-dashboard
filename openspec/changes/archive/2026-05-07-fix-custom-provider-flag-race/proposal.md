# Fix: Custom-provider `custom` flag missing on first `providers_list` push

## Why

`packages/extension/src/provider-register.ts::registerEntry` (line 461)
populates the `lastRegistered` map only **after** an `await
discoverModels(...)` round-trip to the provider's `/v1/models` endpoint.
`activate()` calls `registerEntry` fire-and-forget at module load
(line 559–562), and the bridge's first `providers_list` push fires from
`pi.on("session_start", ...)` at `bridge.ts:1262` shortly after — usually
**before** `discoverModels` resolves.

`buildProviderCatalogue()` at `provider-register.ts:404` derives `customIds`
from `lastRegistered.keys()`. While `lastRegistered` is empty, every
catalogue entry — including custom-registered providers — is emitted
without `custom: true`. The server caches that first push verbatim
(`packages/server/src/event-wiring.ts:613-628`), and
`packages/server/src/provider-auth-storage.ts::_buildAuthStatus` at
line 171 (the consumer-side filter) cannot suppress what isn't flagged.

Net effect: custom providers from `~/.pi/agent/providers.json` (e.g.
`proxy`, `your-llmproxy`) appear as **Add Key** rows under
**Settings → Provider Authentication → API Keys**, alongside pi-ai's
default providers. The dedicated **LLM Providers** section already
manages those entries; the leak duplicates the surface and confuses
which screen owns each provider.

The recovery push fires later — `onProviderChanged` at `bridge.ts:1474–1493`
sends a fresh `providers_list` once `discoverModels` resolves, and that
push DOES carry `custom: true`. The server cache replaces, but
`packages/client/src/components/ProviderAuthSection.tsx::useEffect` at
line 57 only fetches `/api/provider-auth/status` on mount and after
direct credential CRUD. The client never refetches when the corrected
catalogue arrives, so the stale leak persists in the UI until the user
closes and reopens Settings.

## What Changes

- `provider-register.ts::registerEntry` SHALL set `lastRegistered.set(name, ...)`
  **synchronously, before** `await discoverModels(...)`. The flag's
  source of truth is "did the bridge attempt to register this provider
  from `providers.json`?" — that fact is known from the entry passed in,
  not from network discovery completing.
- The pre-existing post-await `lastRegistered.set` at line 484 becomes
  unnecessary and SHALL be removed (the synchronous set covers it).
- The behavior on `discoverModels` failure stays the same: the entry is
  still registered with the bridge (with zero models), and remains
  flagged `custom: true` so the auth-status filter suppresses it from
  Settings → API Keys.
- The catalogue payload-shape requirement in `provider-auth-bridge`
  spec SHALL document the `custom` field (currently undocumented —
  spec drift from `replace-hardcoded-provider-lists`'s tail commits) and
  pin race-free population.

## Capabilities

### Modified Capabilities

- `provider-auth-bridge`: extend "Provider catalogue payload shape" to
  document the `custom` field and add a regression scenario asserting
  that `custom: true` is set on the first `providers_list` push, before
  `discoverModels` resolves.

## Impact

- **Code**: 4 lines moved in `packages/extension/src/provider-register.ts`
  (synchronous `lastRegistered.set` before `await discoverModels`,
  delete the post-await duplicate).
- **Tests**: 1 new test in
  `packages/extension/src/__tests__/build-provider-catalogue.test.ts`
  asserting the catalogue carries `custom: true` for an entry whose
  `discoverModels` has not yet resolved.
- **Protocol**: no change. `custom?: boolean` field already exists in
  `packages/shared/src/types.ts::ProviderInfo`.
- **Migration**: none. Existing caches drop on next bridge push.
- **Risk**: low. The flag is set earlier in the lifecycle; nothing reads
  `lastRegistered` between the new (synchronous) set point and the old
  (post-await) set point during normal operation. `reloadProviders`'s
  diff loop at line 528 already deletes-then-re-sets entries, so the
  new ordering is equivalent for hot-reload too.
- **Out of scope**: the broader "model selector dies after fork/resume"
  bug caused by `event-wiring.ts:628`'s `models_refreshed` broadcast on
  every `providers_list` arrival is a separate concern. Not addressed here.
- **Out of scope**: ProviderAuthSection refetch-on-WS-event (no auto
  refresh after credential changes from another browser tab). Separate
  concern.
