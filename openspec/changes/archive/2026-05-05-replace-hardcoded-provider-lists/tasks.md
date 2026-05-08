## 1. Shared protocol & types

- [x] 1.1 In `packages/shared/src/types.ts`, add `export interface ProviderInfo { id: string; displayName: string; hasOAuth: boolean; configured: boolean; source?: "stored" | "environment" | "fallback" | "runtime"; envVar?: string; ambient?: boolean; expires?: number; }`.
- [x] 1.2 In `packages/shared/src/protocol.ts`, add `ProvidersListMessage { type: "providers_list"; sessionId: string; providers: ProviderInfo[] }` and `RequestProvidersMessage { type: "request_providers"; sessionId: string }`. Add to the appropriate union types alongside `ModelsListMessage` / `RequestModelsMessage`.
- [x] 1.3 In `packages/shared/src/rest-api.ts`, extend the `ProviderAuthStatus` interface with two optional fields: `envVar?: string` and `ambient?: boolean`. Run `npm run lint` (tsc --noEmit) and confirm the workspace is clean.

## 2. Handler-driven OAuth list (local to dashboard, NOT pushed by bridge)

- [x] 2.1 In `packages/server/src/provider-auth-handlers.ts`, add a required `displayName: string` field to the `AuthCodeHandler` and `DeviceCodeHandler` interfaces (next to `flowType` and `providerId`).
- [x] 2.2 Populate `displayName` on each of the 5 existing handler constants using the strings currently in `provider-auth-storage.ts::OAUTH_PROVIDERS`: "Anthropic (Claude Pro/Max)", "ChatGPT Plus/Pro (Codex)", "GitHub Copilot", "Google Gemini CLI", "Antigravity".
- [x] 2.3 Verify `getAllHandlers()` continues to return all 5 handlers and that `getProviderHandler(id)` lookups still work.

## 3. Bridge: build & push catalogue

- [x] 3.1 In `packages/extension/src/provider-register.ts`, add and export a pure helper `_buildProviderCatalogue(modelRegistry, piAi): ProviderInfo[]` per design Decision 3. Inputs: a captured `ModelRegistry` and the pi-ai module (with `findEnvKeys` + `getEnvApiKey`). Output: deduplicated `ProviderInfo[]` covering OAuth providers + every distinct provider from `getAll()`.
- [x] 3.2 Add a public wrapper `buildProviderCatalogue(): ProviderInfo[]` in `provider-register.ts` that uses `getModelRegistry()` and a lazy `import("@mariozechner/pi-ai")` cached at module level. Returns `[]` if the model registry isn't yet captured. The dynamic import is normal here — pi-ai is in scope inside pi's own process.
- [x] 3.3 In `packages/extension/src/command-handler.ts`, add a `case "request_providers"` next to the existing `case "request_models"` that returns `{ type: "providers_list", sessionId, providers: buildProviderCatalogue() }`.
- [x] 3.4 In `packages/extension/src/bridge.ts`, every site that sends `models_list` (lines 423, 1260, 1479) SHALL also send `providers_list` immediately after, using `connection.send({ type: "providers_list", sessionId, providers: buildProviderCatalogue() })`. Wrap with the same try/catch pattern.
- [x] 3.5 In `packages/extension/src/session-sync.ts` (lines 74, 166), apply the same parallel push as 3.4.
- [x] 3.6 In `packages/extension/src/provider-register.ts`'s `credentials_updated` flow (the existing `onProviderChanged` callback / `bridge.ts` handler), add a re-push of `providers_list` for every active session next to the existing `models_list` re-push.

## 4. Server: cache catalogue & consume

- [x] 4.1 Create `packages/server/src/provider-catalogue-cache.ts`. Module-level `Map<string, ProviderInfo[]>` keyed by `sessionId`, plus a `latestSnapshot: ProviderInfo[] | null` for the most-recent push across any session. Exports: `setCatalogueForSession(sessionId, providers)`, `getLatestCatalogue(): ProviderInfo[]`, `clearForSession(sessionId)`, `_resetForTests()`.
- [x] 4.2 In `packages/server/src/event-wiring.ts`, next to the existing `if (msg.type === "models_list")` block (line 603), add `if (msg.type === "providers_list") { setCatalogueForSession(msg.sessionId, msg.providers); /* no browser broadcast — browsers consume via /api/provider-auth/status */ }`.
- [x] 4.3 In `packages/server/src/browser-handlers/subscription-handler.ts` (next to the existing `request_models`), add `piGateway.sendToSession(msg.sessionId, { type: "request_providers", sessionId: msg.sessionId })` so that on subscription, both lists refresh.
- [x] 4.4 In `packages/server/src/browser-handlers/directory-handler.ts` (lines 135-149), add a `case "request_providers"` next to the existing `request_models` forwarder.
- [x] 4.5 In `packages/server/src/provider-auth-storage.ts`: delete the `OAUTH_PROVIDERS` and `API_KEY_PROVIDERS` arrays; keep the lock helpers, `readAuthJson`, `writeAuthJson`, `writeCredential`, `removeCredential` untouched.
- [x] 4.6 Add a pure helper `_buildAuthStatus(catalogue: ProviderInfo[], authData: AuthData, oauthHandlers: ProviderHandler[]): ProviderAuthStatus[]` that performs the merge: emit one OAuth row per handler (using `data[h.providerId]` + handler `displayName` + handler `flowType`); for every catalogue entry emit one API-key row (using suffix `-api` and `${name} (API Key)` when the id collides with an OAuth handler's `providerId`); preserve masked-key formatting; for ambient catalogue entries, force `authenticated: true` and `maskedKey: "(ambient)"`. No async, no I/O.
- [x] 4.7 Replace `getAuthStatus(): ProviderAuthStatus[]` with a thin function that reads `auth.json`, calls `getLatestCatalogue()`, and delegates to `_buildAuthStatus`. Stays synchronous (no async cascade).
- [x] 4.8 Replace `getOAuthProvidersMeta()` with a one-line return that derives from `getAllHandlers()`: `getAllHandlers().map(h => ({id: h.providerId, name: h.displayName, flowType: h.flowType}))`. Stays synchronous.
- [x] 4.9 Replace `resolveAuthJsonKey(providerId)` with a catalogue lookup over `getLatestCatalogue()`: find a row where `id === providerId` and return its underlying id (strip `-api` suffix). Fall back to `providerId` itself when not found. Stays synchronous.
- [x] 4.10 In `packages/server/src/server.ts`, after route registration, request a fresh `providers_list` from every connected bridge as a startup warm-up. (The piGateway broadcast helper already exists; if not, send via `request_providers` to each connected session.)
- [x] 4.11 In `packages/server/src/routes/provider-auth-routes.ts`, before returning the result of `getAuthStatus()` from `GET /api/provider-auth/status`, if `getLatestCatalogue().length === 0`, send `request_providers` to every connected bridge (best-effort) so the next poll has data. Don't block the current response.

## 5. Tests

- [x] 5.1 `packages/extension/src/__tests__/build-provider-catalogue.test.ts`: exercises `_buildProviderCatalogue` with a fake `modelRegistry` covering: OAuth-only id (anthropic), API-key-only id (deepseek), OAuth+API-key id (anthropic appears once with `hasOAuth: true`), ambient (vertex with `getEnvApiKey` returning `"<authenticated>"`), env-set (openai with `findEnvKeys` returning `["OPENAI_API_KEY"]`), and an extension-registered provider id appearing in `getAll()` but not in pi-ai's static list (asserts `displayName` falls back to id when `getProviderDisplayName` returns the id verbatim).
- [x] 5.2 `packages/server/src/__tests__/build-auth-status.test.ts`: exercises `_buildAuthStatus` end-to-end:
  - Empty catalogue + empty `auth.json` → just OAuth handler rows, all `authenticated: false`.
  - Catalogue with anthropic (`hasOAuth: true`) + `auth.json` with anthropic OAuth credential → 2 rows: anthropic (OAuth) `authenticated: true` with expires, anthropic-api `authenticated: false`.
  - Catalogue with deepseek + `auth.json` empty + envVar set → row has `envVar: "DEEPSEEK_API_KEY"`, `authenticated: false`.
  - Catalogue with google-vertex `ambient: true` → row has `authenticated: true`, `maskedKey: "(ambient)"`, regardless of `auth.json`.
  - Catalogue with deepseek + `auth.json` containing deepseek api_key → row has `authenticated: true`, masked key, no `envVar` (env not set).
- [x] 5.3 `packages/server/src/__tests__/provider-catalogue-cache.test.ts`: tests for cache behavior — set/get/clear/_reset; latestSnapshot reflects the last setCatalogueForSession across multiple sessions.
- [x] 5.4 `packages/server/src/__tests__/event-wiring-providers-list.test.ts`: integration test confirming a `providers_list` message arriving via piGateway updates the cache and a subsequent `getAuthStatus()` reflects it.
- [x] 5.5 Update `packages/server/src/__tests__/provider-auth-storage.test.ts`: replace assertions over the hardcoded arrays with assertions that use a pre-populated catalogue cache; expand expected row count.

## 6. Verification

- [x] 6.1 Run `npm test` and confirm all server + extension tests pass.
- [x] 6.2 `npm run build && curl -X POST http://localhost:8000/api/restart && npm run reload`. Then `curl -s http://localhost:8000/api/provider-auth/status | jq` and verify the response includes new entries (deepseek, fireworks, cerebras, mistral, etc.) with `envVar` populated when those env vars are set.
- [x] 6.3 In the dashboard browser, open Settings → Provider Authentication. Verify the API-key section now lists every provider pi knows. Save and remove a key for a new provider (e.g. `deepseek`); confirm it writes to `auth.json` correctly. Verify the OAuth login flow for anthropic still completes end-to-end and the `anthropic-api` row remains independent.
- [x] 6.4 Inspect `~/.pi/dashboard/server.log` after first hit on `/api/provider-auth/status`: zero noise on success. If the bridge is intentionally absent (e.g. the server is started but no pi session running), confirm OAuth UI still works and API-key list shows the "waiting for pi" empty state.
- [x] 6.5 Live-test the extension-registered case: start a pi session that registers an extension provider (e.g. via `pi-model-proxy`), refresh the dashboard, confirm the new provider appears as an API-key row.

## 7. Documentation

- [x] 7.1 Update `docs/file-index-extension.md` to add a row for the new helper in `provider-register.ts` (caveman style): "buildProviderCatalogue() — derives ProviderInfo[] from captured modelRegistry. Used by command-handler request_providers and by all sites that push models_list."
- [x] 7.2 Update `docs/file-index-server.md` to add a row for `provider-catalogue-cache.ts` (caveman style): "Module-level Map of sessionId -> ProviderInfo[] cached from bridge providers_list pushes. latestSnapshot used by /api/provider-auth/status when session unspecified."
- [x] 7.3 Append a `CHANGELOG.md` entry under `## [Unreleased] → ### Changed` describing the visible UI difference (full provider list now manageable; env-var hints surfaced; ambient AWS/GCP credentials detected; extension-registered providers visible).
