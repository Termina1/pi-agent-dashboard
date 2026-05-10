## Context

The pi-agent-dashboard is a long-lived daemon that already aggregates pi sessions, hosts a Fastify HTTP server with WebSocket gateways, and reads `~/.pi/agent/{auth,providers,models}.json` for its provider-config surface (`packages/server/src/routes/provider-routes.ts`). It does **not** currently speak any LLM provider directly — its only LLM-facing logic is `provider-probe.ts`, which sends 2-token credential probes to verify reachability.

External services (Honcho, LangChain, CI runners, custom apps) routinely need an OpenAI-compatible HTTP endpoint that fronts whatever models the user has authenticated. The upstream extension `@blackbelt-technology/pi-model-proxy` does this but its lifecycle is bound to a single pi session: its HTTP server boots on `extension default()` and closes on `session_shutdown`. Multiple sessions race for `:9876`; zero sessions means zero proxy. That mismatch with "always available while the dashboard runs" is the motivating gap.

**Pre-conditions verified during exploration (2026-05-01), re-verified during runtime-resolve rewrite (2026-05-07a), then again during the in-house-registry rewrite (2026-05-07b):**

- `@mariozechner/pi-ai` exports the full surface the proxy needs: `streamSimple` (upstream HTTP/SSE call, abortable via `AbortSignal`), the `MODELS` table (auto-generated catalog with context window / max-tokens / cost / capability metadata), `register-builtins` (returns the built-in provider table), per-provider OAuth refresh helpers in `oauth.ts` (Anthropic, Codex, Gemini CLI, GitHub Copilot, Antigravity), `transform-messages.ts` for shape normalization, and the `Model<Api>` types. Confirmed at `pi-ai/dist/index.d.ts` v0.73.0.
- pi-ai is ~5 MB on disk plus 11 SDK transitives. pi-coding-agent is ~181 MB — essentially all of it (agent runtime, tool calling, prompt building, ask_user, settings manager) is unrelated to the model-proxy use case.
- The dashboard already reads `~/.pi/agent/{auth,providers,models}.json` directly via existing modules: `provider-auth-storage.ts` (auth.json read/write with locking), `routes/provider-routes.ts` (providers.json read/write), `provider-catalogue-cache.ts` (caches bridge-pushed catalogue). Composing them into a per-model resolver is well-scoped (~50 lines).
- The dashboard already has a writer for `~/.pi/agent/auth.json` — `provider-auth-storage.ts` (`writeCredential`) — used by OAuth-flow completion routes. Reusing this writer for OAuth-refresh-on-expiry collapses the would-be "three writers, one file" problem to two (dashboard + bridge sessions, exactly as today).
- The dashboard's `ToolRegistry` (`packages/shared/src/tool-registry/`) is the runtime-resolution mechanism for external pi packages. `pi-coding-agent` is already registered there for `package-manager-wrapper.ts`; the proxy adds a new `pi-ai` registration.
- `pi-ai` is currently a transitive dep of `pi-coding-agent`. When `bootstrap-install-from-list.ts` installs `pi-coding-agent` into `~/.pi-dashboard/node_modules/`, npm typically hoists `pi-ai` to the same top-level. If hoisting fails on a particular machine, an explicit pi-ai entry in the install list is the documented fallback (tasks.md §2.7).
- `packages/server/src/provider-catalogue-cache.ts` is **bridge-pushed** — each pi session pushes its `providers_list` over WS for `/api/provider-auth/status`. The proxy does NOT replace this; the cache continues to serve its existing consumers. The proxy maintains its OWN server-resident registry for `/v1/*` request handling.
- The upstream `pi-model-proxy/src/convert/` code is MIT-licensed pure functions — eligible for lift with attribution.
- The dashboard's auth plugin (`packages/server/src/auth-plugin.ts`) already gates routes via an `onRequest` hook; adding a `/v1/*`-scoped proxy-key check ahead of the JWT hook is additive.

## Goals / Non-Goals

**Goals:**

- Mount OpenAI-compatible (`/v1/chat/completions`) and Anthropic-compatible (`/v1/messages`) endpoints on the dashboard server, plus `GET /v1/models`.
- Reuse the dashboard's effective model catalog — the same set the `/model` dropdown shows. Both the proxy's in-house registry and pi sessions' `ModelRegistry` compose `auth.json` + `providers.json` + `models.json` over pi-ai's built-ins, so they agree by construction.
- Authenticate external clients via dedicated **proxy API keys**, separate from the user-facing dashboard JWT.
- Stream upstream provider responses back to the client with `AbortSignal` propagation on client disconnect.
- Refresh model availability when the user logs into a new provider, edits `providers.json`, or imports `models.json` — no server restart required.
- Expose a settings UI surface for toggling, configuring default model, and managing API keys.

**Non-Goals:**

- Replacing or deprecating upstream `@blackbelt-technology/pi-model-proxy`. It continues to be the right answer for users running pi without the dashboard.
- Multi-tenant provider routing (round-robin across N keys, sticky sessions, provider pools). The proxy resolves credentials via pi's normal rules; if you have one Anthropic OAuth, you get one upstream connection.
- Supporting non-OpenAI/non-Anthropic *client* formats (no Google Generative AI–shape inputs, no Bedrock-shape inputs). Upstream providers in any of pi's supported APIs are fine — only the *client-facing* shape is restricted.
- Provider credentials owned by the dashboard. Credentials remain in `~/.pi/agent/auth.json` (managed by pi via `AuthStorage`). The dashboard reads through pi's storage abstraction.
- File uploads, audio, embeddings, image generation. Chat-completion + messages-streaming only in this phase.
- Per-API-key cost accounting / usage dashboards. A simple request log is in scope; richer telemetry is a follow-up.

## Decisions

### 1. Server-resident registry built on pi-ai primitives (no pi-coding-agent dep)

**Decision:** The dashboard server instantiates a server-resident registry built **directly on pi-ai's primitives** — not on pi-coding-agent's `ModelRegistry`/`AuthStorage`. The proxy's only runtime-resolved external module is `pi-ai`. Requests do **not** round-trip through a connected pi session's bridge.

Concretely:

- `internal-registry.ts` (~50 lines) reads `~/.pi/agent/{auth,providers,models}.json` via the dashboard's existing readers, composes them with `pi-ai.registerBuiltins()`, and exposes the methods the proxy needs (`getAvailable`, `find`, `getApiKeyAndHeaders`, `refresh`, `getAll`).
- `internal-auth-storage.ts` (~70 lines) wraps the existing `provider-auth-storage.ts#writeCredential` writer with pi-ai's per-provider OAuth refresh helpers; on `getApiKeyAndHeaders()` for an OAuth model with an expired token, it refreshes and persists.
- `pi-ai` is runtime-resolved via the existing `ToolRegistry.resolveModule("pi-ai")`, exactly like `package-manager-wrapper.ts` resolves `pi-coding-agent`. No direct deps in `packages/server/package.json`.

**Why server-resident (vs bridge-delegated):**

- The user's stated requirement is "always-on while the dashboard runs". Bridge-delegation needs ≥1 connected session — fails when sessions are all closed.
- pi-ai's `streamSimple` is designed for standalone use; we are not pulling on threads that weren't already exposed.
- Avoids a new bridge protocol message and the associated WS round-trip latency.
- Makes test harnesses trivially predictable — a Fastify-only fixture.

**Why in-house registry over pi-coding-agent's `ModelRegistry`/`AuthStorage`:**

- **Surface area.** pi-coding-agent is ~181 MB on disk; ~99% of that is agent runtime, tool calling, prompt building, ask_user, settings manager — none of which the proxy uses. We need ~10 symbols from it. Building those ~10 symbols ourselves over pi-ai (~120 lines total) is cheaper than carrying the full agent runtime as a runtime dep.
- **Single-writer contract on `auth.json`.** The dashboard already owns a writer (`provider-auth-storage.ts`) for OAuth-flow completion. Adopting pi-coding-agent's `AuthStorage` for OAuth-refresh-on-expiry would introduce a *third* writer with a *different* lock convention (`AuthStorage` uses `proper-lockfile`; `provider-auth-storage.ts` uses `mkdir`-based locking). The in-house path reuses the existing writer, so the dashboard remains a single-writer process — bridge sessions are the only other writers, exactly as today.
- **Stability surface.** pi-ai is a low-level HTTP/SSE library; its public exports (`streamSimple`, `MODELS`, `oauth.ts` helpers, `transform-messages`) change less often than pi-coding-agent's higher-level `ModelRegistry`/`AuthStorage` API. Tracking ~10 stable symbols is easier than tracking ~30 mid-level ones.
- **Composition rules are simple.** The registry composition is: built-in providers ∪ `providers.json` ∪ (models from `models.json` whose provider has auth) — filtered by `auth.json` keys. ~50 lines of straightforward logic.

**Why runtime-resolved (vs `pi-ai` as a direct dep in `packages/server/package.json`):**

- The dashboard's existing architecture treats pi packages as **external runtime dependencies** supplied by the user's pi install / Electron's bundled install / `~/.pi-dashboard/` managed install / npm-global. `package-manager-wrapper.ts` and `bootstrap-install-from-list.ts` already establish this contract.
- Keeps the published `@blackbelt-technology/pi-dashboard-server` package small (~5 MB saved).
- Decouples dashboard release cycle from pi-ai version: the existing `pi-version-skew.ts` machinery remains the single compatibility gate.

**Alternatives considered:**

- **C0: bridge-delegated.** Forward `/v1/*` requests via WS to any connected session. Rejected: "no sessions = 503".
- **C1: spawn a hidden pi as the proxy.** Rejected: paying for a full pi runtime when pi-ai's `streamSimple` does the work in-process.
- **C2: server-resident + pi-coding-agent runtime-resolved.** Rejected (this rewrite's predecessor): unnecessary 175 MB carry, three-writer smell on `auth.json`.
- **C3: server-resident + pi-coding-agent + pi-ai as direct deps.** Rejected: forks the existing pi-resolution contract, ~180 MB published-package bloat.
- **C4: drop pi-ai too, reimplement upstream HTTP/SSE per-provider.** Rejected: 11 SDK transitives + per-provider OAuth quirks + weekly MODELS-table churn. Owning that surface is a net loss.
- **C5: ship a small subset extracted from pi-ai/pi-coding-agent into a private package.** Rejected: requires upstream cooperation we don't have. May revisit if upstream decides to publish `@mariozechner/pi-llm-client`.

**Cost:** ~120 lines of new code (`internal-registry.ts` + `internal-auth-storage.ts`) plus one new `pi-ai` registration row in `tool-registry/definitions.ts`. **Risk:** when the user's pi-ai install is missing/broken, the proxy is unavailable — same failure semantics as `package-manager-wrapper.ts` has for pi-coding-agent. Surfaced via `/api/health` (`proxy.status: "degraded"`) and a clear 503 + `code: "MODEL_PROXY_RUNTIME_MISSING"` from `/v1/*`.

### 2. Authentication: uniform proxy API key, no JWT, no bypass inheritance

**Decision:** `/v1/*` routes SHALL require a valid proxy API key on every request. The dashboard's existing bypass rules (loopback, `bypassHosts`, `bypassUrls`) DO NOT apply to `/v1/*`. Dashboard JWT is NOT accepted for `/v1/*`. Keys carry scopes (`models:list`, `chat`, `messages`, or `all`), an optional `expiresAt`, a soft-delete `revokedAt`, and a `createdBy` user attribution. Failed auth attempts are subject to per-source-IP exponential backoff.

**Why uniform (no source-based exceptions):**

- The dashboard's existing bypass rules were designed for "a human in a browser using the UI" — the threat model is different from "a programmatic LLM client". Inheriting them silently grants programmatic access to anyone the dashboard considers UI-trusted.
- The most dangerous bypass for `/v1/*` is `bypassHosts` (trusted LAN). A user who configured `192.168.0.0/16` as trusted because they trust their home network for the dashboard UI did not necessarily mean to grant LLM-spend authority to every device on the network.
- A uniform rule eliminates the entire class of "I forgot a tunnel was up" or "I forgot LAN was trusted" exposure bugs.

**Why no JWT:**

- Dashboard JWT is OAuth-bound to a human; pasting it into Honcho's config gives Honcho human-equivalent access — the same coupling we set out to avoid. Better to never accept it on `/v1/*` so the only thing a user can paste into a non-human client is a key designed for non-human clients.
- The dashboard UI's own "Test" button (the one use case JWT-on-loopback was meant to serve) instead uses a user-issued API key cached in browser `sessionStorage` after first creation. Setup wizard prompts for one. See Decision 9.

**Why scopes:**

- Real-world precedent (OpenAI, Anthropic, GitHub) supports scoped keys. Default `["all"]` is invisible to users who don't care; available when they do (e.g. issue a `models:list`-only key to a discovery service that doesn't need to spend tokens).

**Why soft-delete:**

- `revokedAt` (vs hard splice) keeps request-log entries attributable. The settings UI shows revoked keys in a collapsed section; user can purge for real via a separate action.

**Why per-user ownership:**

- Multi-user dashboards (`auth.allowedUsers` size ≥ 2) need this to prevent user A from seeing/revoking user B's keys. Default install is single-user, so the rule is invisible until the second user joins. Adds one filter on list/delete; cheap. An optional `auth.admin: <email>` flag grants override (admin sees and manages every user's keys).

**Why backoff (and not hard lockout):**

- API keys are 288 bits and unguessable in absolute terms. The threat is misconfigured-client noise (retry-storms with a wrong key) and prefix-pattern attacks (`pi-proxy-test...`, common-leak prefixes). Exponential delay (10ms → cap 10s) absorbs both without ever locking out a legitimate user.

**Storage:** `~/.pi/dashboard/config.json#modelProxy.apiKeys[]` with entries `{id, label, createdBy, scopes, createdAt, lastUsedAt?, expiresAt?, revokedAt?, hash}`. Hash is `sha256(key)`; cleartext keys are reveal-once in the UI, never persisted.

**Format on the wire:** `Authorization: Bearer pi-proxy-<48-char-base64url>`. Prefix is a sentinel — the auth gate detects "this is a proxy key" before any verification, so JWT rejection is `O(prefix-check)` not `O(JWT-decode)`.

**Alternatives considered:**

- **Inherit dashboard bypasses (Option 1 from explore-mode workshop).** Rejected: programmatic threat model differs from human-UI threat model; bypassHosts is the dangerous case; uniform rule is simpler and safer.
- **Tiered (read free on bypass, write requires key) (Option 3).** Rejected: more complex auth tree without proportional benefit; users discover the asymmetry via 401-on-completion which is a poor UX.
- **JWT-only.** Rejected: forces UI users to leak human credentials to non-human clients.
- **JWT-on-loopback carve-out for the UI.** Rejected: "loopback" can include shared-machine scenarios where `127.0.0.1` is not actually private; the UI's `sessionStorage`-cached key is cheaper and uniformly safer.
- **mTLS.** Rejected: too heavy for "Honcho on localhost". Revisit if the proxy ever needs cross-machine auth without a tunnel.
- **No auth (loopback only).** Rejected: violates defense-in-depth — a tunnel makes `:8000/v1/...` reachable from anywhere on the internet, and recursion-guard alone is insufficient.
- **Hard lockout after N failures.** Rejected: a misconfigured client could lock its owner out of their own keys. Backoff is gentler and equally effective.

### 3. Endpoint shape: `:8000/v1/...` by default, optional `:secondPort`

**Decision:** Default mount is on the existing dashboard port at `/v1/...`. A `modelProxy.secondPort` config knob (e.g. `9876`) optionally binds a second listener that proxies `/v1/*` to the same handlers — for SDKs that hardcode path-prefix-less base URLs.

**Why:**

- Most OpenAI-compatible clients accept arbitrary `base_url` values: `http://host:8000/v1` works for `openai`, `langchain`, `anthropic`, Honcho, and the OpenAI Python/Node SDKs. Confirmed via spot checks of those library docs.
- A small minority of integrations append paths past `/v1` and assume `<base>/chat/completions` (no version prefix), or assume the host alone is the base and then concatenate `/v1/chat/completions`. The optional second port covers them without forcing every user to deal with the corner case.
- Same-port-default reuses dashboard CORS, dashboard tunnel passthrough, dashboard `/api/health` discovery — significant DRY win.

**Alternatives considered:**

- **Always two ports.** Rejected: doubles the firewall surface for a feature most users won't need.
- **Path-prefix only.** Rejected: leaves the corner-case clients with no clean path.
- **Subdomain (`proxy.dashboard.local`).** Rejected: requires DNS configuration most users don't have.

### 4. Format conversion: lift from upstream pi-model-proxy

**Decision:** Copy `pi-model-proxy/src/convert/{openai-in,openai-out,anthropic-in,anthropic-out}.ts` and the SSE event-translator helpers into `packages/server/src/model-proxy/convert/` with a header-comment attribution to the MIT upstream.

**Why:**

- The conversion logic is the most subtle part of any LLM proxy: tool-call indexing, multi-tool batches, thinking/reasoning blocks, image-content arrays, system-message handling. Re-implementing it would be slower AND introduce drift from a known-working baseline.
- The upstream code is pure functions over pi-ai event types — no extension API surface, no lifecycle coupling. Lifts cleanly.
- License compatibility: pi-agent-dashboard is itself licensed under a permissive license; MIT lift with attribution is unambiguous.

**Maintenance plan:** When upstream releases bug-fixes to `convert/`, manually port them. The two trees may diverge (e.g. dashboard adds reasoning-content shape support before upstream); document divergences in `model-proxy/convert/UPSTREAM.md`.

**Alternatives considered:**

- **Depend on `@blackbelt-technology/pi-model-proxy` as a library.** Rejected: that package is structured as a pi extension (default-export expecting `ExtensionAPI`), not as a reusable converter library. Importing internal `convert/` modules is brittle and unsupported.
- **Re-implement from scratch.** Rejected: slow and error-prone for no upside.

### 5. Registry refresh policy

**Decision:** Refresh the in-house registry on the following events, all eager (no per-request refresh, no polling):

| Trigger | Implementation site |
|---|---|
| `PUT /api/providers` (custom provider edit) | `packages/server/src/routes/provider-routes.ts` after successful write |
| `POST /api/provider-auth/...` (OAuth login completes) | `packages/server/src/routes/provider-auth-routes.ts` after token persisted |
| `POST /api/config` (dashboard config save) | `packages/server/src/config-api.ts` after merge |
| Bridge `credentials_updated` event | `packages/server/src/event-wiring.ts` after broadcasting to browsers |
| `/v1/models` request | NO — refresh is too expensive; rely on the eager triggers |

**Why:** `InternalRegistry.refresh()` re-reads disk and re-parses `models.json`; it's not free. Eager refresh on the four mutation sites covers every realistic credential change. Pure-on-disk edits (e.g. user manually edits `models.json` outside the dashboard) are a 30-second-staleness corner case we accept; users can hit the refresh button (REST: `POST /api/model-proxy/refresh`) if they need immediate effect.

### 6. Recursion guard

**Decision:** When `PUT /api/providers` writes a custom provider entry, validate that `provider.baseUrl` does not resolve to the dashboard's own listen origin. Reject with HTTP 400 + error body `{ code: "RECURSIVE_PROXY", message: "...", offendingBaseUrl }` if it does.

**Why:** A custom provider whose `baseUrl` points back at the dashboard creates a request loop: client → `:8000/v1` → registry resolves the model → calls `:8000/v1` → registry resolves → calls `:8000/v1` → … until the upstream timeout fires. Catching it at write time gives the user a clear error instead of a request that hangs.

**Implementation:** Compare normalized `baseUrl` (host+port, ignoring path/scheme casing) against:
- `localhost:<dashboardPort>`, `127.0.0.1:<dashboardPort>`, `[::1]:<dashboardPort>`
- The dashboard's bound address when not loopback (e.g. LAN IP from `os.networkInterfaces()`)
- The mDNS-advertised hostname, when mDNS is active

**Edge case accepted:** A user who points their custom provider at `http://10.0.0.5:8000/v1` from a different machine, where `10.0.0.5` happens to be this dashboard, evades the guard. We do not chase that — the recursion would manifest as upstream timeout on first request, and the failure mode is local rather than global (only that custom-provider record is broken). Documented in the spec scenario.

### 7. AbortSignal propagation

**Decision:** Every `/v1/chat/completions` and `/v1/messages` handler creates an `AbortController`, forwards `controller.signal` into `streamSimple`, and aborts on Fastify's `request.raw.on("close", ...)` (client disconnect during stream). Confirmed pattern from upstream pi-model-proxy.

**Why:** LLM streams cost real money. A client that disconnects mid-stream (Honcho's worker died, browser tab closed, tunnel dropped) MUST not keep paying for tokens. This is non-negotiable.

### 8. Concurrency caps

**Decision:** Three nested caps:

- **Server-wide**: `modelProxy.maxConcurrentStreams` config (default 16). 503 Retry-After when exceeded.
- **Per-API-key**: `modelProxy.perKeyConcurrentStreams` (default 4). 429 when exceeded.
- **Per-upstream-provider**: hard-coded sensible defaults (Anthropic free tier dies at ~5; default to 4 to leave headroom). Override via `modelProxy.perProviderCaps[provider]` if the user has a paid tier.

Per-key tracking is in-memory; survives daemon lifetime, not across restarts. Acceptable — restarts are rare and reset is the safe direction.

**Alternatives considered:**

- **Token-bucket rate limit (req/min) instead of concurrency cap.** Rejected: streaming requests are long-lived; concurrency is the bottleneck, not request rate. Both can coexist later if needed.

### 9. Logging

**Decision:** Optional JSONL request log at `~/.pi/dashboard/model-proxy.jsonl` (gated by `modelProxy.logRequests: true`, default `false`). Each line: `{ts, requestId, apiKeyId?, model, format, status, durationMs, inputTokens?, outputTokens?, error?}`. **Never logs request body, response body, or API keys.**

**Why:** Debugging "why is Honcho hammering me" is a real need; debugging "what did the LLM say" is not the proxy's job.

## Risks / Trade-offs

### 1. Version-coupling with pi-ai

**Risk:** The proxy depends on pi-ai's public surface (`streamSimple`, `MODELS`, `register-builtins`, `oauth.ts` per-provider helpers, `transform-messages`, `Model<Api>` types). A pi-ai breaking change in any of these breaks the proxy at runtime.

**Mitigation:**

- Runtime resolution via `ToolRegistry` (Decision 1) keeps the coupling out of `packages/server/package.json` — the existing `pi-version-skew.ts` machinery remains the single compatibility gate.
- Precondition test `packages/server/src/__tests__/pi-ai-shape.test.ts` resolves pi-ai through the registry and asserts the symbols we use (`streamSimple`, `MODELS`, `registerBuiltins`, the OAuth helper exports for each supported provider). `it.skip`-able when pi-ai cannot be resolved (clean CI without `~/.pi-dashboard/` populated); full and required when it can. `MODEL_PROXY_REQUIRE_PI_AI=1` env var forces hard-fail for release-cut runs.
- Failures at runtime degrade `/v1/*` to 503 + `code: "MODEL_PROXY_RUNTIME_MISSING"`; the dashboard does not crash.
- The surface area we track is intentionally small (~10 symbols). pi-ai changes are easier to follow than pi-coding-agent changes.

**Accepted because:** pi-ai is a stable lower-level library with a less-volatile public API than pi-coding-agent's higher-level `ModelRegistry`/`AuthStorage`.

### 2. OAuth refresh contention (single-writer-on-dashboard contract)

**Risk:** A pi session AND the dashboard server both call into auth refresh at the same moment, both notice the OAuth token expired, both attempt refresh, both write to `~/.pi/agent/auth.json` → lock contention or token churn.

**Mitigation:**

- **The dashboard has exactly one writer for `auth.json`: `provider-auth-storage.ts`.** The proxy's `internal-auth-storage.ts` reuses this writer (calls `writeCredential`); it does NOT add a parallel write path. So the only cross-process contention is between dashboard ↔ pi session(s), exactly as today — no new pairing is introduced.
- Pi sessions write `auth.json` via pi-coding-agent's `AuthStorage`, which uses `proper-lockfile`. The dashboard's `provider-auth-storage.ts` currently uses a `mkdir`-based lock. **Recommended (orthogonal but related):** upgrade `provider-auth-storage.ts` to `proper-lockfile` so dashboard and bridge sessions share one lock convention. This is a small, isolated patch — see tasks.md §2.5.
- Acceptance tests:
  1. Concurrent refresh from `internal-auth-storage` AND a stub pi-session AuthStorage — assert no `auth.json` corruption (parsed JSON valid before/after).
  2. Last-writer-wins is acceptable: whichever side completes refresh first writes the new token; the other side reloads, sees it fresh, and skips redundant refresh.
- Documented in `docs/architecture.md` under "auth.json write contract".

### 3. Streaming inside Fastify

**Risk:** Fastify SSE has gotchas — `reply.raw.write` interactions with compression middleware, default keep-alive timeouts, header flush timing. The dashboard already streams via WS (terminals) but not SSE.

**Mitigation:** Use the upstream pi-model-proxy's exact SSE pattern (`reply.raw.writeHead(200, sseHeaders); for await (const event of stream) reply.raw.write(formatEvent(event)); reply.raw.end()`). Disable compression on `/v1/*` routes via Fastify's per-route `compress: false`. Set `request.raw.setTimeout(0)` so streams aren't killed by the dashboard's default request timeout.

### 4. Runtime-resolution miss (pi-ai not installed)

**Risk:** A user's machine has the dashboard installed but no pi-ai install reachable by `ToolRegistry` (no `~/.pi-dashboard/`, no npm-global pi-ai, no override). `getModelRegistry()` throws `ModuleResolutionError`.

**Mitigation:** Same failure mode `package-manager-wrapper.ts` already has for pi-coding-agent and surfaces via `/api/packages`. The proxy reuses that pattern:

- Returns 503 + `code: "MODEL_PROXY_RUNTIME_MISSING"` from `/v1/*` with a `details` field carrying `ToolRegistry`'s diagnostic trail.
- Shows a non-blocking warning in `ModelProxySection.tsx` ("pi-ai not installed in any known location") with a one-click "Install via bootstrap" button that triggers the existing `bootstrap-install` flow with `["@mariozechner/pi-ai"]` (or `["@mariozechner/pi-coding-agent"]` if hoisting is reliable on the user's npm).
- Health endpoint reports `proxy.status: "degraded" | "ready"`.

**Accepted because:** the failure mode is identical to existing pi-dependent features and the user has clear remediation paths. The likelihood is also low: pi-ai is a transitive of pi-coding-agent which the dashboard already installs by default.

### 5. Coexistence with upstream pi-model-proxy

**Risk:** A user runs both: dashboard with this proxy on `:8000/v1`, AND `@blackbelt-technology/pi-model-proxy` extension on `:9876` inside one of the pi sessions. Both work; nothing breaks; user sees two endpoints with potentially-different auth and slightly-different model-availability semantics.

**Mitigation:** Document the coexistence in `docs/architecture.md`. **Don't enforce mutual exclusion** — it's a legitimate setup if the user wants both. The recommendation in the docs will be: pick one, disable the other.

### 6. API key reveal-once UX

**Risk:** Reveal-once is the standard pattern but users *will* lose keys, then complain. Recovery is "revoke and create new".

**Mitigation:** UI copy explicitly says "Save this now — you cannot view it again." Console-warn pattern in tests. Standard industry behavior.

## Migration Plan

This is a new capability. No migration of existing data.

For users currently running upstream pi-model-proxy:

1. Continue running it. The dashboard proxy coexists silently as long as ports differ.
2. Optionally: edit `~/.pi/agent/settings.json` to remove `npm:@blackbelt-technology/pi-model-proxy` from `packages[]`, restart pi sessions. This stops the upstream extension from binding `:9876`.
3. Update any external service's `base_url` from `http://localhost:9876/v1` to `http://localhost:8000/v1` (and replace the (currently-optional) upstream `apiKey` config with a dashboard-issued proxy API key).

Documented in `docs/migration/from-pi-model-proxy.md` (created as part of this change).

## Open Questions

1. **Should `/v1/models` enrich the response with reasoning/cost/context-window metadata** (mirroring `provider-register.ts`'s `enrichModelMetadata`)? Useful for clients that want to pick the cheapest model dynamically. Tilts toward yes — adds ~200 lines, no downside. **Resolution before tasks.md is written:** yes, include the enrichment fields under an `x-pi` namespace per OpenAI's extension convention so we don't break strict OpenAI clients.

2. **Should we expose a streaming-only flag (`stream: true` mandatory) for tighter resource control?** No, the OpenAI shape allows non-streaming and breaking that breaks compatibility. Keep both.

3. **Allowing extensions in pi sessions to talk to the dashboard proxy** (creating a "shared cache" of OAuth refreshes)? Probably yes eventually — but out-of-scope for this change. Capture as a follow-up: `add-extension-model-proxy-client`.

4. **Cost/usage tracking surface in the settings panel?** Captured as out-of-scope above. Re-visit when there's enough request volume to make the data interesting.

5. ~~**Tunnel-aware default**~~ — subsumed by Decision 2's uniform-API-key rule. With JWT rejected on every source, there is nothing to gate further on the tunnel side.
