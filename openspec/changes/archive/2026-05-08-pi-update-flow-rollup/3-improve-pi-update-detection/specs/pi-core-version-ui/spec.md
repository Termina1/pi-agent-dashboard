## ADDED Requirements

### Requirement: Auto-check installed packages for updates
The dashboard SHALL automatically check installed packages for available updates without requiring the user to click `[Check Now]`. This mirrors pi's interactive-TUI behaviour, which runs `packageManager.checkForAvailableUpdates()` on every startup.

#### Scenario: Auto-check fires on mount
- **WHEN** `UnifiedPackagesSection` mounts AND the initial installed-packages list has loaded
- **THEN** the section SHALL issue `POST /api/packages/check-updates` exactly once, automatically, without user interaction
- **AND** populate the per-row `updateAvailable` indicator from the response

#### Scenario: Auto-check polls periodically
- **WHEN** `UnifiedPackagesSection` is mounted
- **THEN** the section SHALL re-issue `POST /api/packages/check-updates` every 30 minutes
- **AND** the polling cadence SHALL be cancelled on unmount

#### Scenario: Auto-check re-fires after package operation
- **WHEN** a `package_operation_complete` WS message is received with `success: true`
- **THEN** the section SHALL re-issue `POST /api/packages/check-updates`
- **AND** the updated `updateAvailable` set SHALL be reflected on every affected row immediately

#### Scenario: Manual Check Now still works
- **WHEN** the user clicks the `[Check Now]` button
- **THEN** the section SHALL issue `POST /api/packages/check-updates` immediately
- **AND** the auto-poll timer SHALL be reset to 30 minutes from the manual click

#### Scenario: Auto-check failure does not disrupt UI
- **WHEN** the auto-check request fails (network, 4xx, 5xx)
- **THEN** the section SHALL NOT display an inline error
- **AND** the next scheduled poll SHALL still fire
- **AND** existing rows SHALL continue to render whatever update state was last successfully fetched

## MODIFIED Requirements

### Requirement: Breaking-change icon on Core rows
The Core sub-group of `UnifiedPackagesSection` SHALL render a "what's new" icon next to the row's `[Update]` button whenever a non-empty changelog is available between the row's installed and latest versions, regardless of whether the changelog contains breaking changes.

The icon SHALL render in one of two visual states:

- **Breaking state** — `mdiAlertCircleOutline` from `@mdi/js`, amber color (`text-amber-400`), `aria-label` "Breaking changes since your version — click for details" — used when the changelog contains ≥1 `### Breaking Changes` section in range.
- **Info state** — `mdiInformationOutline` from `@mdi/js`, muted color (`text-[var(--text-muted)]`), `aria-label` "View what's new — click to see release notes" — used when the changelog has releases in range but no breaking changes.

The icon SHALL NOT render when the changelog endpoint returned `releases: []` (no release notes available for the range).

#### Scenario: Breaking icon when breaking changes exist
- **WHEN** a Core row's package has `updateAvailable: true`
- **AND** `GET /api/pi-core/changelog?pkg=<row.name>&from=<currentVersion>&to=<latestVersion>` returns `hasBreaking: true`
- **THEN** the row SHALL render the amber `mdiAlertCircleOutline` icon between the version arrow and the `[Update]` button

#### Scenario: Info icon when no breaking changes but releases exist
- **WHEN** the changelog response returns `hasBreaking: false`
- **AND** `releases.length > 0`
- **THEN** the row SHALL render the muted `mdiInformationOutline` icon between the version arrow and the `[Update]` button
- **AND** the row's existing `[Update]` button SHALL remain functional

#### Scenario: Icon hidden when no releases
- **WHEN** the changelog response returns `releases: []`
- **OR** the package has `updateAvailable: false`
- **THEN** the row SHALL NOT render any what's-new icon

#### Scenario: Icon hidden for non-pi packages
- **WHEN** the row's package name is not `@mariozechner/pi-coding-agent` (or its declared successor)
- **THEN** the row SHALL NOT render any what's-new icon, regardless of changelog response
- **AND** the changelog endpoint SHALL NOT be requested for that row

#### Scenario: Icon hidden during loading and error states
- **WHEN** the changelog request is in flight
- **OR** the changelog request failed
- **THEN** the row SHALL NOT render any what's-new icon
- **AND** the row's existing `[Update]` button SHALL remain functional

#### Scenario: Icon click opens WhatsNewDialog
- **WHEN** the user clicks any what's-new icon (breaking or info state)
- **THEN** the section SHALL open `WhatsNewDialog` populated with the changelog response that produced the icon
- **AND** the dialog's `[Update to <latest>]` CTA SHALL be wired to the same `onUpdate` handler as the row's `[Update]` button

#### Scenario: Tooltip text matches state
- **WHEN** the user hovers the icon (pointer devices) in breaking state
- **THEN** a tooltip SHALL display "<N> breaking change(s) since your version" where N is the count of breaking-change bullets across all releases in the response
- **WHEN** the user hovers the icon in info state
- **THEN** a tooltip SHALL display "View what's new"
