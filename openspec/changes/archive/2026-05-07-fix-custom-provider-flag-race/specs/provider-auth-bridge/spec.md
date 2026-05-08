## MODIFIED Requirements

### Requirement: Provider catalogue payload shape
Each entry in the `providers` array of `providers_list` SHALL be an object with the following fields, derived from pi's live `ModelRegistry` and the bridge's own custom-provider tracking:

- `id` (string, required): pi-ai provider id (e.g. `"anthropic"`, `"deepseek"`, `"google-vertex"`).
- `displayName` (string, required): from `modelRegistry.getProviderDisplayName(id)`.
- `hasOAuth` (boolean, required): `true` iff `authStorage.getOAuthProviders().some(p => p.id === id)`.
- `configured` (boolean, required): `authStorage.has(id)` — true when there is a stored credential in `auth.json`.
- `source` (`"stored" | "environment" | "fallback" | "runtime" | undefined`, optional): from `authStorage.getAuthStatus(id).source`.
- `envVar` (string, optional): the first env var name returned by pi-ai's `findEnvKeys(id)`.
- `ambient` (boolean, optional): `true` when `pi-ai.getEnvApiKey(id) === "<authenticated>"` (Vertex ADC / Bedrock IAM).
- `expires` (number, optional): for OAuth credentials, the `expires` timestamp from `auth.json`.
- `custom` (boolean, optional): `true` iff the bridge itself registered this provider via `pi.registerProvider(...)` from `~/.pi/agent/providers.json`. Consumers (notably `provider-auth-storage.ts::_buildAuthStatus`) SHALL use this flag to suppress API-key auth rows for custom providers, which are managed by the dedicated **LLM Providers** settings section.

The catalogue SHALL be the union of `authStorage.getOAuthProviders().map(p => p.id)` AND every distinct `provider` value from `modelRegistry.getAll()`. Duplicates are deduplicated by `id`.

The `custom` flag SHALL be set synchronously when the bridge attempts to register a provider from `providers.json`, **independently** of asynchronous model-discovery completion. Specifically, the bridge SHALL track custom-provider ids the moment `registerEntry` is invoked — before any `await` — so that the very first `providers_list` push (typically fired from `session_start` shortly after `activate()` kicked off async `registerEntry` calls) carries the correct flags. This rules out a race where the first push leaks custom providers into Settings → API Keys until the async discovery probe resolves.

#### Scenario: Built-in API-key provider
- **WHEN** pi-ai's `MODELS` table contains a model with `provider: "deepseek"` and the user has not configured any auth
- **THEN** the catalogue SHALL contain `{id: "deepseek", displayName: "DeepSeek", hasOAuth: false, configured: false, envVar: undefined, ambient: undefined}` with no `custom` field

#### Scenario: Provider with env var set but no auth.json entry
- **WHEN** `OPENAI_API_KEY` is exported to the bridge process
- **THEN** the `openai` catalogue entry SHALL have `configured: false`, `source: "environment"`, `envVar: "OPENAI_API_KEY"`

#### Scenario: OAuth provider with stored credentials
- **WHEN** `auth.json` contains `{ "anthropic": { type: "oauth", access, refresh, expires } }`
- **THEN** the `anthropic` catalogue entry SHALL have `hasOAuth: true`, `configured: true`, `source: "stored"`, `expires: <timestamp>`

#### Scenario: Ambient credential (Vertex ADC)
- **WHEN** `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` are all set
- **THEN** the `google-vertex` catalogue entry SHALL have `ambient: true` and `source: "environment"`

#### Scenario: Extension-registered provider visible
- **WHEN** another pi extension calls `pi.registerProvider("custom-llm", { models: [...], oauth: {...} })`
- **THEN** the next `providers_list` push SHALL contain a `custom-llm` entry with `hasOAuth: true`

#### Scenario: Custom provider from providers.json carries custom:true on first push (regression)
- **WHEN** `~/.pi/agent/providers.json` contains a `proxy` entry with `baseUrl` pointing to an OpenAI-compatible endpoint
- **AND** the bridge's `activate()` has begun async `registerEntry("proxy", ...)` but `discoverModels` for `proxy` has NOT yet resolved
- **AND** the bridge calls `buildProviderCatalogue()` to build the first `providers_list` payload
- **THEN** the catalogue SHALL include a `proxy` entry with `custom: true`
- **AND** the server-side consumer `_buildAuthStatus` SHALL skip emitting an API-key row for `proxy`
- **AND** Settings → Provider Authentication → API Keys SHALL NOT list `proxy`

#### Scenario: discoverModels failure for a custom provider
- **WHEN** the bridge's `discoverModels` for `proxy` resolves with HTTP failure or network timeout
- **THEN** `proxy` SHALL still be present in `lastRegistered`
- **AND** the next `providers_list` push SHALL still carry `custom: true` for `proxy`
- **AND** `proxy` SHALL still be filtered from Settings → API Keys
