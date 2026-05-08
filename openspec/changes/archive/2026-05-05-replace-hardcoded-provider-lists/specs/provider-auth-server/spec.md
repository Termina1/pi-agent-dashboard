## MODIFIED Requirements

### Requirement: OAuth provider registry
The server SHALL maintain a registry of OAuth provider handlers. Each handler SHALL expose its provider ID, display name, flow type (`auth_code` or `device_code`), and methods for its specific OAuth flow. The registry of available OAuth providers exposed by `GET /api/provider-auth/providers` SHALL be derived directly from the registered handler set, not from a separately maintained list. Each handler SHALL carry its own `displayName` field, removing the need for any duplicated `OAUTH_PROVIDERS` array elsewhere in the server module. The registry SHALL include handlers for: `anthropic`, `openai-codex`, `github-copilot`, `google-gemini-cli`, and `google-antigravity`.

#### Scenario: List available OAuth providers
- **WHEN** a client requests `GET /api/provider-auth/providers`
- **THEN** the server SHALL return a JSON array of objects, each containing `id`, `name`, and `flowType` for every registered OAuth handler, with `name` taken from the handler's `displayName` field

#### Scenario: Adding a new OAuth handler is the only required change
- **WHEN** a developer registers a new handler in the handler registry with `providerId`, `displayName`, and `flowType`
- **THEN** the new provider SHALL appear in the `GET /api/provider-auth/providers` response without any change to a separate provider list

### Requirement: API key provider registry
The server SHALL derive the list of API-key providers from the bridge-pushed provider catalogue (`providers_list` message), NOT from a hardcoded array. The most recently received catalogue is cached per pi process; on cache miss the server SHALL proactively send `request_providers` and use an empty list until the bridge responds. For every entry in the cached catalogue:

- If the catalogue id collides with a registered OAuth handler's `providerId`, the API-key row SHALL use the suffixed UI id `${id}-api`, the suffixed display name `${displayName} (API Key)`, and an `authJsonKey` equal to the unsuffixed catalogue id.
- If the catalogue id has no OAuth handler counterpart, the API-key row SHALL use the bare id and bare display name, with `authJsonKey` equal to the id.

The server SHALL pass the catalogue's `envVar` and `ambient` fields straight through to the corresponding `ProviderAuthStatus` rows. When `ambient: true`, the server SHALL force `authenticated: true` and `maskedKey: "(ambient)"` even when `auth.json` has no entry for `authJsonKey`.

#### Scenario: Catalogue from bridge defines the API-key list
- **WHEN** the bridge has pushed `providers_list` containing 25 entries (anthropic, deepseek, fireworks, ...)
- **AND** a client requests `GET /api/provider-auth/status`
- **THEN** the response SHALL include one row per entry, with `flowType: "api_key"` for non-OAuth ids and the `<id>-api` suffix for OAuth-collision ids

#### Scenario: OAuth/API-key collision uses suffixed id
- **WHEN** the catalogue contains an entry with `id: "anthropic"` and `hasOAuth: true`
- **AND** the OAuth handler set contains a handler with `providerId: "anthropic"`
- **THEN** the status response SHALL contain two distinct rows: one OAuth row with `id: "anthropic"`, `name: "Anthropic (Claude Pro/Max)"`, `flowType: "auth_code"` (from the handler), and one API-key row with `id: "anthropic-api"`, `name: "Anthropic (API Key)"`, `flowType: "api_key"`, `authJsonKey: "anthropic"`

#### Scenario: Provider with no OAuth uses bare id
- **WHEN** the catalogue contains an entry with `id: "deepseek"`, `hasOAuth: false`
- **THEN** the status response SHALL contain one row with `id: "deepseek"`, `flowType: "api_key"`, `authJsonKey: "deepseek"`

#### Scenario: Env-var hint surfaces from catalogue
- **WHEN** the catalogue's `openai` entry has `envVar: "OPENAI_API_KEY"`
- **THEN** the corresponding row in the status response SHALL include `envVar: "OPENAI_API_KEY"`

#### Scenario: Ambient credentials marked authenticated
- **WHEN** the catalogue's `google-vertex` entry has `ambient: true`
- **THEN** the row SHALL have `authenticated: true`, `ambient: true`, and `maskedKey: "(ambient)"` regardless of `auth.json` contents

#### Scenario: Catalogue not yet received
- **WHEN** the server has not yet received any `providers_list` from any bridge
- **THEN** the API-key portion of the status response SHALL be an empty array, the OAuth portion SHALL still be returned, and the server SHALL have proactively sent `request_providers` to all connected bridges

#### Scenario: Extension-registered provider appears
- **WHEN** another pi extension calls `pi.registerProvider("custom-llm", ...)` and the bridge pushes a fresh `providers_list`
- **THEN** the server cache SHALL be updated and a `custom-llm` row (or `custom-llm-api` if the OAuth handler set grows) SHALL appear in the next `GET /api/provider-auth/status` response without any server restart

### Requirement: Credential status API
The server SHALL expose `GET /api/provider-auth/status` returning the authentication status of all providers. For each provider it SHALL return: `id`, `name`, `flowType`, `authenticated` (boolean), and for OAuth providers the `expires` timestamp if authenticated. For API-key providers the response MAY include `envVar` (string, name of the env variable pi-ai consults for this provider) and `ambient` (boolean, true when the provider is configured via an ambient credential chain such as AWS profile or Google ADC). The server SHALL NOT return tokens or secrets.

#### Scenario: Mixed authenticated and unauthenticated providers
- **WHEN** `auth.json` contains credentials for `anthropic` and `openai` but not `github-copilot`
- **THEN** the status response SHALL show `authenticated: true` with `expires` for `anthropic`, `authenticated: true` for `openai` (API key, no expiry), and `authenticated: false` for `github-copilot`

#### Scenario: API-key row carries envVar hint
- **WHEN** the catalogue's `mistral` entry has `envVar: "MISTRAL_API_KEY"` and `auth.json` has no `mistral` entry
- **THEN** the `mistral` row in the status response SHALL include `envVar: "MISTRAL_API_KEY"` and `authenticated: false`

### Requirement: Credentials updated triggers catalogue refresh
When the server broadcasts `credentials_updated` to bridges (e.g. after a `PUT /api/provider-auth/api-key` write), the bridge SHALL respond with a fresh `providers_list` per the existing flow. The server SHALL replace the cached catalogue on receipt and broadcast `models_refreshed` to browsers as it does today.

#### Scenario: Refresh after API-key write
- **WHEN** a client writes a new API key via `PUT /api/provider-auth/api-key`
- **THEN** the server SHALL persist the credential, broadcast `credentials_updated` to bridges, receive a fresh `providers_list`, update the catalogue cache, and broadcast `models_refreshed` to browsers

#### Scenario: Stale browser query before refresh completes
- **WHEN** a client polls `GET /api/provider-auth/status` immediately after a write, before the bridge round-trip completes
- **THEN** the response SHALL reflect the previous catalogue plus the just-written `auth.json` change (the server-side `auth.json` masked-key extraction is local and immediate; only the env/ambient fields lag the bridge round-trip)
