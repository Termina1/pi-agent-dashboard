## ADDED Requirements

### Requirement: Bridge pushes providers_list message
The bridge SHALL emit a `providers_list` message to the server alongside `models_list` whenever the model registry's provider catalogue is observable. The message SHALL be sent (a) on session register / re-attach (parallel to the existing `models_list` push), (b) on receipt of `credentials_updated`, and (c) in response to `request_providers`.

#### Scenario: providers_list sent at session register
- **WHEN** the bridge has captured `ctx.modelRegistry` and is about to send `models_list` for `sessionId`
- **THEN** the bridge SHALL also send `{ type: "providers_list", sessionId, providers: <ProviderInfo[]> }` to the server

#### Scenario: providers_list refreshed after credential change
- **WHEN** the bridge receives `{ type: "credentials_updated" }` and `modelRegistry` is available
- **THEN** the bridge SHALL build a fresh provider catalogue and send a new `providers_list` for every active sessionId

#### Scenario: providers_list before modelRegistry capture
- **WHEN** the bridge has not yet observed `ctx.modelRegistry`
- **THEN** the bridge SHALL skip the `providers_list` push and the server SHALL receive only `models_list` (which is also skipped today). No error.

### Requirement: Provider catalogue payload shape
Each entry in the `providers` array of `providers_list` SHALL be an object with the following fields, derived from pi's live `ModelRegistry`:

- `id` (string, required): pi-ai provider id (e.g. `"anthropic"`, `"deepseek"`, `"google-vertex"`).
- `displayName` (string, required): from `modelRegistry.getProviderDisplayName(id)`.
- `hasOAuth` (boolean, required): `true` iff `authStorage.getOAuthProviders().some(p => p.id === id)`.
- `configured` (boolean, required): `authStorage.has(id)` — true when there is a stored credential in `auth.json`.
- `source` (`"stored" | "environment" | "fallback" | "runtime" | undefined`, optional): from `authStorage.getAuthStatus(id).source`.
- `envVar` (string, optional): the first env var name returned by pi-ai's `findEnvKeys(id)`.
- `ambient` (boolean, optional): `true` when `pi-ai.getEnvApiKey(id) === "<authenticated>"` (Vertex ADC / Bedrock IAM).
- `expires` (number, optional): for OAuth credentials, the `expires` timestamp from `auth.json`.

The catalogue SHALL be the union of `authStorage.getOAuthProviders().map(p => p.id)` AND every distinct `provider` value from `modelRegistry.getAll()`. Duplicates are deduplicated by `id`.

#### Scenario: Built-in API-key provider
- **WHEN** pi-ai's `MODELS` table contains a model with `provider: "deepseek"` and the user has not configured any auth
- **THEN** the catalogue SHALL contain `{id: "deepseek", displayName: "DeepSeek", hasOAuth: false, configured: false, envVar: undefined, ambient: undefined}`

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

### Requirement: Bridge handles request_providers
When the bridge receives a `request_providers` message from the server, it SHALL respond with a `providers_list` for the message's `sessionId`, using the same catalogue-build logic as the periodic push.

#### Scenario: Server requests refresh
- **WHEN** the bridge receives `{ type: "request_providers", sessionId: "s1" }`
- **THEN** the bridge SHALL emit `{ type: "providers_list", sessionId: "s1", providers: [...] }` based on the current `modelRegistry` state

#### Scenario: Request without modelRegistry
- **WHEN** the bridge receives `request_providers` before `session_start` has captured `ctx.modelRegistry`
- **THEN** the bridge SHALL respond with `{ type: "providers_list", sessionId, providers: [] }` and no error
