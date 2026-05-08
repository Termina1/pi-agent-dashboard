## Context

The dashboard's provider-auth UI is fed by `provider-auth-storage.ts`, which today owns two hardcoded arrays:

- `OAUTH_PROVIDERS` (5 entries) — duplicates the dashboard's own OAuth handler registry (`provider-auth-handlers.ts::handlers`).
- `API_KEY_PROVIDERS` (8 entries) — a curated subset of the ~25 providers pi-ai actually supports.

The bridge extension (`packages/extension/src/`) runs **inside** pi's Node process. It captures `ctx.modelRegistry` at `session_start` and already pushes `models_list` over a long-lived WS to the server (see `command-handler.ts::request_models`, `bridge.ts:423,1260,1479`, `session-sync.ts`). The server caches it and forwards to every browser via `event-wiring.ts:603`.

`ModelRegistry` exposes:
- `authStorage.getOAuthProviders(): OAuthProviderInterface[]` — live list including extension-registered.
- `authStorage.getAuthStatus(id): {configured, source, label}` — per-provider configured state.
- `getProviderDisplayName(id): string` — canonical human-readable name.
- `getAll(): Model[]` — every model the registry knows about, each carrying a `provider` field.

So everything the dashboard's UI needs is in scope inside the bridge. The fix is to add a parallel `providers_list` push that mirrors the existing `models_list` plumbing, then have the server consume it instead of its hardcoded arrays.

## Goals / Non-Goals

**Goals:**

- Eliminate `OAUTH_PROVIDERS` and `API_KEY_PROVIDERS` arrays from `provider-auth-storage.ts`.
- Surface every provider pi knows about — built-in (~25) plus any added at runtime via `pi.registerProvider(...)` — in the dashboard's auth UI.
- Preserve the browser API contract: `ProviderAuthStatus[]` shape unchanged except for two optional fields (`envVar?`, `ambient?`); `<provider-id>-api` suffix convention preserved for OAuth/API-key collisions.
- Surface env-var hints (e.g. "configured via `OPENAI_API_KEY`") and ambient credentials (Vertex ADC, Bedrock IAM) using pi-ai's existing detection logic — invoked by the bridge, never by the server.

**Non-Goals:**

- No `package.json` changes. No new tool-registry entries. No file-URL imports of pi-ai from the server.
- No browser-side rendering changes (UI compaction of the longer list is a follow-up).
- No unifying `auth.json` and `providers.json`.
- No replacing the homemade `mkdir`-based lockfile with pi's `proper-lockfile` (separate proposal).

## Decisions

### Decision 1: Bridge as the single source of provider truth

Pi-ai and pi-coding-agent are reachable only inside pi's process. The bridge is the only dashboard component that runs there. Rather than the server attempting filesystem walks / dynamic ESM imports / tool-registry resolution gymnastics, the bridge introspects `modelRegistry` and pushes the catalogue.

**Alternative considered (rejected):** server-side resolution of pi-ai via `ToolRegistry` + walk of pi-coding-agent's nested `node_modules`. Rejected because:
- pi-ai's `exports` map is ESM-only and blocks `./package.json` / `./dist/*` subpaths, defeating `createRequire.resolve` (the trick `resolve-jiti.ts` uses for jiti).
- `npm root -g`, managed-module, and bare-import strategies don't reach packages nested under pi-coding-agent.
- The dashboard would still miss extension-registered providers because they live in the bridge's `ModelRegistry` instance, not on disk.
- Doing what the bridge already does, in a process that has no business doing it.

### Decision 2: Mirror the existing `models_list` plumbing — no new architecture

The bridge already sends `models_list` from `modelRegistry.getAvailable()`:
- on session register / re-attach (`bridge.ts`),
- after `credentials_updated` (`provider-register.ts`),
- on `request_models` from the server (`command-handler.ts`).

We add `providers_list` and `request_providers` next to them, sent at the same moments, with the same lifetime semantics, the same forwarding logic in `event-wiring.ts`. Server-side cache is keyed the same way (per-pi-process; one pi process = one bridge connection = one catalogue).

### Decision 3: Catalogue payload is a flat array of derived facts, not a Registry slice

Each catalogue entry is `{id, displayName, hasOAuth, configured, source?, envVar?, ambient?, expires?}`. The bridge derives this from `modelRegistry` once per push:

```ts
function buildProviderCatalogue(mr: ModelRegistry): ProviderInfo[] {
  const oauthIds = new Set(mr.authStorage.getOAuthProviders().map(p => p.id));
  const allIds = new Set([
    ...oauthIds,
    ...mr.getAll().map(m => m.provider),
  ]);
  return [...allIds].map(id => {
    const status = mr.authStorage.getAuthStatus(id);
    const cred = mr.authStorage.get(id);
    const envKeys = findEnvKeys(id) ?? [];
    const ambient = getEnvApiKey(id) === "<authenticated>";
    return {
      id,
      displayName: mr.getProviderDisplayName(id),
      hasOAuth: oauthIds.has(id),
      configured: status.configured,
      source: status.source,
      envVar: envKeys[0],
      ambient: ambient || undefined,
      expires: cred?.type === "oauth" ? cred.expires : undefined,
    };
  });
}
```

`findEnvKeys` and `getEnvApiKey` are imported by the bridge from `@mariozechner/pi-ai` — already in scope inside pi's process; no resolution problem.

**Alternative considered (rejected):** ship the raw `Map` of registered providers. Rejected — too much surface, includes serialization-unfriendly objects, exposes pi-ai internals that may change between versions.

### Decision 4: Server caches per pi process, falls back to empty + proactive refresh

`event-wiring.ts:603` is the existing `models_list` forwarder; we add a sibling block for `providers_list` that updates a module-level `Map<sessionId, ProviderInfo[]>` AND a process-wide latest snapshot used by routes when no session is specified. On `GET /api/provider-auth/status`:
1. Read the cached catalogue (the most-recently-received one across any session). If empty, send `request_providers` to every connected bridge as a side-effect and proceed with empty.
2. Read `auth.json` (existing logic) for masked-key + expiry per row.
3. Merge per-row, applying the OAuth/API-key collision rule and the `-api` suffix.

**Alternative considered (rejected):** synchronous proxy — block the route handler until a `providers_list` is received. Rejected for added latency and the corner case of a route arriving before any bridge has connected (would deadlock).

### Decision 5: Test strategy

- **Pure**: `_buildAuthStatus(catalogue, authData, oauthHandlers)` — pure function exercised with synthetic inputs covering every collision/ambient/envVar permutation. No I/O.
- **Bridge**: `_buildProviderCatalogue(modelRegistry, piAi)` — pure function, tested by passing a fake `modelRegistry` (just `getAuthStatus`, `getOAuthProviders`, `getAll`, `getProviderDisplayName` stubs) and a fake pi-ai (`findEnvKeys`, `getEnvApiKey` stubs).
- **Wire**: integration test of `event-wiring.ts` confirming a `providers_list` message updates the cache and `getAuthStatus()` reflects it.
- **No real-pi smoke test required** — the bridge unit test is enough; the server never imports pi-ai.

## Risks / Trade-offs

- **[Risk] Server starts before any bridge connects** → API-key list is empty for the gap. Mitigation: server caches the catalogue indefinitely after first push; `request_providers` is sent on every browser query when cache is empty; the gap is sub-second in normal flows. UI shows OAuth section + an explanatory "waiting for pi" hint when catalogue is empty.
- **[Risk] Bridge runs an older pi without `getProviderDisplayName`** → Mitigation: bridge falls back to id-as-name when the method is absent; payload remains valid; server treats missing displayName as identical to id.
- **[Risk] Catalogue payload size grows over time** → ~25 entries × small objects ≈ <2KB; trivially fine over the existing WS.
- **[Risk] Multiple bridges per server** (theoretical, dashboard supports many sessions but one pi process per dashboard) → Each session pushes its own catalogue; the server's "process-wide snapshot" uses the most recent. Mismatch possible only if two pi processes have radically different extension sets — acceptable; rare; user-explicable.
- **[Trade-off] `<provider-id>-api` suffix preserved** → Slightly awkward but breaking it would invalidate browser-side id comparisons. Worth keeping.
- **[Trade-off] Env / ambient detection runs in the bridge, not the server** → The bridge's process env governs what counts as "configured"; in normal use the bridge inherits the user's shell env via the spawn, so this matches user expectations. If a user starts the server with a different env from the bridge (rare, advanced), the bridge wins.

## Migration Plan

Non-breaking refactor. Deploy by:
1. Land the bridge change first (back-compat: server without the corresponding handler ignores `providers_list` silently, falling through to old hardcoded arrays).
2. Land the server change. Old bridges will not push `providers_list`; server's catalogue stays empty until a new bridge reconnects → graceful degraded UI (OAuth section + empty API-key section + waiting hint).
3. No data migration. `auth.json` schema unchanged.
4. Rollback: revert the server change first (re-enables the hardcoded arrays); bridge change is harmless on its own (server ignores the message).

## Open Questions

- Should the catalogue also surface a `available: boolean` flag (provider has at least one model registered)? Useful for hiding rows for providers the user hasn't loaded models for. **Tentative answer: no, out of scope; today every API-key row appears regardless of model presence and we shouldn't change that here.**
- Should `request_providers` be an explicit subscribe/unsubscribe so server-driven catalogue refreshes are scoped, or is the existing per-session push enough? **Tentative answer: the per-session push is enough; `request_providers` exists only for the cold-cache server-init case.**
