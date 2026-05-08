## MODIFIED Requirements

### Requirement: Credentials updated triggers catalogue refresh
When the server broadcasts `credentials_updated` to bridges (e.g. after a `PUT /api/provider-auth/api-key` write), the bridge SHALL respond with a fresh `providers_list` per the existing flow. The server SHALL replace the cached catalogue on receipt and broadcast `models_refreshed` to browsers when the catalogue contents actually changed.

The catalogue-arrival broadcast SHALL be gated on a deep-equality check (`setCatalogueForSession` returning `{ changed: true }`) against the previously-cached payload for that session. Routine bridge state-syncs — every browser subscribe (which triggers the server's `request_providers` round-trip), every `session_register`, every reconnect, and every fork/resume `handleSessionChange` — re-send identical payloads; broadcasting `models_refreshed` on those identical re-pushes wipes every browser's `modelsMap` and (because App.tsx's auto-subscribe effect skips re-requesting models for any session already in `subscribedRef`) leaves previously-visited sessions with an empty model selector until the next reconnect.

The credential-write paths (`provider-auth-routes.ts` and `provider-routes.ts`) SHALL continue to broadcast `models_refreshed` directly when they persist a credential change. Those broadcasts are independent of the catalogue-arrival path and are unconditional — the credential WAS just modified, the broadcast is precise.

#### Scenario: Refresh after API-key write
- **WHEN** a client writes a new API key via `PUT /api/provider-auth/api-key`
- **THEN** the server SHALL persist the credential, broadcast `credentials_updated` to bridges, receive a fresh `providers_list` with at least one differing field (e.g. `configured`, `source`, or `custom`), update the catalogue cache, and broadcast `models_refreshed` to browsers exactly once

#### Scenario: Identical providers_list re-push does NOT trigger broadcast (regression)
- **WHEN** a bridge sends a `providers_list` whose contents deep-equal the catalogue currently cached for that session
- **THEN** the server SHALL update the per-session cache value (idempotent)
- **AND** the server SHALL NOT broadcast `models_refreshed` to browsers
- **AND** the server SHALL NOT update the global `latestSnapshot` reference (so it continues to reflect the most recent CHANGED catalogue across any session)

#### Scenario: First providers_list for a session triggers broadcast
- **WHEN** the bridge for session `s1` sends its first `providers_list` after server start
- **AND** no entry for `s1` exists in the cache yet
- **THEN** the server SHALL cache the payload as the new entry for `s1`
- **AND** the server SHALL broadcast `models_refreshed` exactly once

#### Scenario: providers_list with flipped custom flag triggers broadcast
- **WHEN** the bridge for session `s1` previously sent a `providers_list` where the entry for provider `proxy` had no `custom` field set
- **AND** the bridge later sends a `providers_list` (e.g. after async `discoverModels` resolved per `fix-custom-provider-flag-race`) where the same `proxy` entry has `custom: true`
- **THEN** the server SHALL detect the change and broadcast `models_refreshed`

#### Scenario: Stale browser query before refresh completes
- **WHEN** a client polls `GET /api/provider-auth/status` immediately after a write, before the bridge round-trip completes
- **THEN** the response SHALL reflect the previous catalogue plus the just-written `auth.json` change (the server-side `auth.json` masked-key extraction is local and immediate; only the env/ambient fields lag the bridge round-trip)
