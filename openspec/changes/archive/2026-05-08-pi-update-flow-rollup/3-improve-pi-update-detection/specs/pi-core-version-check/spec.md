## ADDED Requirements

### Requirement: pi.dev version check
The server SHALL query `https://pi.dev/api/latest-version` for `@mariozechner/pi-coding-agent` (and any successor `packageName` returned by previous pi.dev responses) instead of querying the npm registry directly. The npm registry SHALL be used as a fallback when pi.dev is unreachable, returns an error, or is skipped via environment variables.

#### Scenario: pi.dev queried for pi-coding-agent
- **WHEN** `PiCoreChecker.getStatus()` runs and a managed/global install of `@mariozechner/pi-coding-agent` is discovered
- **THEN** the server SHALL issue `GET https://pi.dev/api/latest-version` with header `User-Agent: pi/<currentVersion> (<platform>; <runtime>; <arch>)` matching pi's own self-update User-Agent
- **AND** parse the JSON response into `{ version: string, packageName?: string }`
- **AND** populate `PiCorePackage.latestVersion` from `response.version`

#### Scenario: pi.dev unreachable falls back to npm registry
- **WHEN** the pi.dev request fails (network error, non-2xx status, malformed JSON)
- **THEN** the server SHALL fall back to `fetchPackageMeta` against the npm registry for the same package name
- **AND** the fallback path SHALL produce a `PiCorePackage` with the same shape as the pi.dev path

#### Scenario: PI_OFFLINE skips pi.dev
- **WHEN** the `PI_OFFLINE` environment variable is set (any non-empty value)
- **THEN** the server SHALL NOT issue the pi.dev request
- **AND** SHALL fall back to the npm registry path immediately

#### Scenario: PI_SKIP_VERSION_CHECK skips pi.dev
- **WHEN** the `PI_SKIP_VERSION_CHECK` environment variable is set (any non-empty value)
- **THEN** the server SHALL NOT issue the pi.dev request
- **AND** SHALL fall back to the npm registry path immediately

#### Scenario: pi.dev returns dynamic packageName
- **WHEN** the pi.dev response includes a non-empty `packageName` field
- **THEN** the server SHALL treat that name as a trusted alias for `@mariozechner/pi-coding-agent`
- **AND** subsequent calls to `discoverGlobal()` and `discoverManaged()` SHALL include packages installed under that name in the result list, even if the name is not in the static `CORE_PACKAGE_NAMES` whitelist

#### Scenario: pi.dev not queried for non-pi packages
- **WHEN** `PiCoreChecker` checks any package other than `@mariozechner/pi-coding-agent` and its declared successors
- **THEN** the server SHALL use the npm registry path directly
- **AND** SHALL NOT issue any request to pi.dev

#### Scenario: 10-second timeout
- **WHEN** the pi.dev request takes longer than 10 seconds
- **THEN** the request SHALL be aborted via `AbortSignal.timeout(10000)`
- **AND** the server SHALL fall back to the npm registry path

#### Scenario: User-Agent reflects current pi version
- **WHEN** the pi.dev request is issued
- **THEN** the User-Agent header SHALL be `pi/<currentVersion> (<process.platform>; <runtime>; <process.arch>)` where `<runtime>` is `node/<process.version>` (or `bun/<bunVersion>` if running under Bun)
- **AND** the User-Agent SHALL NOT identify the dashboard separately

#### Scenario: No request when pi not yet installed
- **WHEN** no managed or global install of `@mariozechner/pi-coding-agent` is discovered
- **THEN** the server SHALL skip the pi.dev request entirely (since there is no `currentVersion` to send in the User-Agent)

#### Scenario: Cache TTL applies
- **WHEN** `PiCoreChecker.getStatus()` is called twice within 5 minutes
- **THEN** the second call SHALL return the cached result without re-issuing either pi.dev or npm registry requests

#### Scenario: Cache invalidation re-fetches via pi.dev
- **WHEN** `PiCoreChecker.invalidate()` is called (typically after a successful core update)
- **THEN** the next `getStatus()` SHALL re-issue the pi.dev request (cache cleared)
