## ADDED Requirements

### Requirement: Breaking-change icon on Core rows
The Core sub-group of `UnifiedPackagesSection` SHALL render a breaking-change warning icon next to the row's `[Update]` button when the row's package has breaking changes between its installed and latest versions.

The icon SHALL be `mdiAlertCircleOutline` from `@mdi/js`. The icon's `aria-label` SHALL be "Breaking changes since your version — click for details".

#### Scenario: Icon visible when breaking changes exist
- **WHEN** a Core row's package has `updateAvailable: true`
- **AND** `GET /api/pi-core/changelog?pkg=<row.name>&from=<currentVersion>&to=<latestVersion>` returns `hasBreaking: true`
- **THEN** the row SHALL render the breaking-change icon between the version arrow and the `[Update]` button

#### Scenario: Icon hidden when no breaking changes
- **WHEN** the changelog response returns `hasBreaking: false`
- **OR** the package has `updateAvailable: false`
- **THEN** the row SHALL NOT render the icon
- **AND** the row's visual layout SHALL be identical to its current behaviour

#### Scenario: Icon hidden for non-pi packages
- **WHEN** the row's package name is not `@mariozechner/pi-coding-agent`
- **THEN** the row SHALL NOT render the icon, regardless of `hasBreaking` value
- **AND** the changelog endpoint SHALL NOT be requested for that row

#### Scenario: Icon hidden during loading and error states
- **WHEN** the changelog request is in flight
- **OR** the changelog request failed
- **THEN** the row SHALL NOT render the icon
- **AND** the row's existing `[Update]` button SHALL remain functional and enabled

#### Scenario: Icon click opens WhatsNewDialog
- **WHEN** the user clicks the breaking-change icon
- **THEN** the section SHALL open `WhatsNewDialog` populated with the changelog response that produced the icon
- **AND** the dialog's `[Update to <latest>]` CTA SHALL be wired to the same `onUpdate` handler as the row's `[Update]` button

#### Scenario: Tooltip on hover
- **WHEN** the user hovers the breaking-change icon (pointer devices)
- **THEN** a tooltip SHALL display the text "<N> breaking changes since your version" where N is the count of breaking-change bullets across all releases in the response

### Requirement: On-demand changelog fetch
The Core sub-group SHALL fetch the changelog for `@mariozechner/pi-coding-agent` lazily — only when an update is available — and reuse the cached result for subsequent renders within the same session.

#### Scenario: Fetch triggered when update appears
- **WHEN** `usePiCoreVersions` reports the pi row transitioning from `updateAvailable: false` to `updateAvailable: true`
- **THEN** the section SHALL issue exactly one `GET /api/pi-core/changelog` request for that version range
- **AND** SHALL NOT issue duplicate requests for the same `(currentVersion, latestVersion)` pair within the same session

#### Scenario: No fetch when up to date
- **WHEN** the pi row reports `updateAvailable: false`
- **THEN** the section SHALL NOT issue any changelog request

#### Scenario: Re-fetch after pi update completes
- **WHEN** a `package_operation_complete` WebSocket message is received for `@mariozechner/pi-coding-agent`
- **AND** the post-update version comparison again yields `updateAvailable: true` (e.g., another release landed)
- **THEN** the section SHALL re-issue the changelog request for the new range

#### Scenario: Failure does not block row interaction
- **WHEN** the changelog request fails (network error, 4xx, 5xx)
- **THEN** the section SHALL NOT display the icon
- **AND** the row's `[Update]` button SHALL remain enabled and functional
- **AND** an error MAY be logged client-side but SHALL NOT be displayed inline on the row
