## Why

`packages/server/src/provider-auth-storage.ts` hardcodes two arrays — `OAUTH_PROVIDERS` (5 entries) and `API_KEY_PROVIDERS` (8 entries) — that duplicate information already live in pi's `ModelRegistry` inside the bridge process. Pi knows about ~27 providers via `pi-ai.getProviders()`, exposes display names through `modelRegistry.getProviderDisplayName(id)`, and tracks per-provider auth status through `modelRegistry.authStorage.getAuthStatus(id)`. None of this reaches the dashboard server today, so users with valid `DEEPSEEK_API_KEY`, `FIREWORKS_API_KEY`, `CEREBRAS_API_KEY`, `MOONSHOT_API_KEY`, `HF_TOKEN`, etc. cannot manage those credentials through the dashboard even though pi will happily use them. Equally, providers added at runtime by another extension via `pi.registerProvider(...)` are invisible.

The fix is a one-line architectural insight: the bridge already pushes `models_list` from `modelRegistry.getAvailable()` to the server over an existing WS channel. Add a parallel `providers_list` message carrying the same registry's provider catalogue, and the server can drop both hardcoded arrays.

## What Changes

- **New protocol message** `providers_list` (bridge → server) and `request_providers` (server → bridge), shaped exactly like the existing `models_list` / `request_models` pair. Carries `ProviderInfo[]` with `{id, displayName, hasOAuth, envVar?, ambient?, configured, source?, expires?}`.
- **Bridge** (`packages/extension/src/provider-register.ts` + `packages/extension/src/command-handler.ts`): new `buildProviderCatalogue(modelRegistry)` helper that reads `authStorage.getOAuthProviders()`, `authStorage.getAuthStatus(id)`, `getProviderDisplayName(id)` from the captured `ModelRegistry`. Pushed alongside `models_list` at session-register time and on `credentials_updated`.
- **Server** (`packages/server/src/event-wiring.ts`, `packages/server/src/provider-auth-storage.ts`): cache the latest pushed catalogue per session (or globally — the catalogue is process-scoped per pi). `getAuthStatus()` consumes the cached catalogue plus the `auth.json` masked-key info; `OAUTH_PROVIDERS` and `API_KEY_PROVIDERS` arrays are deleted. OAuth provider list for `GET /api/provider-auth/providers` derives from the dashboard's OAuth handler registry (`getAllHandlers()` — handlers are local because the dashboard owns the browser-side OAuth flow). Two optional fields added to `ProviderAuthStatus`: `envVar?: string` and `ambient?: boolean`.
- **No `package.json` changes anywhere.** No tool-registry changes. No file-system walks or ESM file-URL imports. The bridge, which runs inside pi's process, is the only consumer of pi-ai / pi-coding-agent APIs — exactly where they are already in scope.
- **No browser-side code changes required.** `ProviderAuthSection.tsx` continues to fetch `/api/provider-auth/status` and renders whatever rows the server returns. The list will simply grow from 8 to ~25 API-key rows as the cached catalogue arrives.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `provider-auth-bridge`: add a requirement that the bridge sends a `providers_list` message when it sends `models_list`, derived from `modelRegistry.authStorage` and `modelRegistry.getProviderDisplayName`.
- `provider-auth-server`: change the source of the OAuth provider registry (still curated, derived from local `getAllHandlers()`) and replace the hardcoded API-key registry with a cached-from-bridge catalogue.

## Impact

- **Bridge**: ~30 lines added in `provider-register.ts` + a new case in `command-handler.ts` next to the existing `request_models` case. Mirrors the existing models_list push.
- **Server**: `provider-auth-storage.ts` shrinks. `event-wiring.ts` gains a `providers_list` forwarder that also stamps a cache. New optional fields on `ProviderAuthStatus`.
- **Dependencies**: zero new package.json entries. Bridge already has pi APIs in scope; server consumes only what the bridge pushes.
- **Risk**: extension-registered OAuth providers (added via `pi.registerProvider({oauth: ...})`) DO become visible automatically because `authStorage.getOAuthProviders()` includes them. The earlier "this needs a separate proposal" disclaimer is dropped — this change covers it.
- **UI**: `ProviderAuthSection.tsx` requires no edits, but visually the API-key section grows from 8 rows to ~25 rows. UI compaction (collapse-by-default unconfigured) is out of scope for this change.
