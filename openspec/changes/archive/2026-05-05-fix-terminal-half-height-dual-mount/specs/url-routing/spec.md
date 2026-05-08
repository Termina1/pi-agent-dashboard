## REMOVED Requirements

### Requirement: Legacy terminal route
**Reason**: The `/terminal/:id` route has had no callers in the client tree since change `2026-04-07-folder-editor-terminals` removed the navigation paths to it. The continuing presence of the route matcher and the keep-alive `<TerminalView>` list it kept warm caused dual-mounting of `<TerminalView>` instances on the folder-terminals page, which manifested as the half-height-rendering bug. Removing the route closes the regression source.

**Migration**: All terminal access SHALL use the folder-scoped route `/folder/:encodedCwd/terminals` (the `Folder terminals route` requirement). Any external bookmark targeting `/terminal/:id` SHALL be served by the SPA catch-all and land on `/`. If real-world breakage emerges, a redirect-only route mapping `/terminal/:id` → `/folder/:encodedCwd/terminals` (looking up the cwd from the terminal id via `terminalManager.get(id).cwd`) MAY be reintroduced as a follow-up; it is not part of this change.

## MODIFIED Requirements

### Requirement: Mobile depth includes settings and tunnel routes
The mobile `MobileShell` depth calculation SHALL treat `/settings`, `/tunnel-setup`, and `/folder/:encodedCwd/terminals` as depth-1 routes, alongside `/session/:id`.

#### Scenario: Settings route sets mobile depth to 1
- **WHEN** the current URL is `/settings` on a mobile viewport
- **THEN** `MobileShell` depth SHALL be 1 and the detail panel SHALL display the Settings page

#### Scenario: Tunnel setup route sets mobile depth to 1
- **WHEN** the current URL is `/tunnel-setup` on a mobile viewport
- **THEN** `MobileShell` depth SHALL be 1 and the detail panel SHALL display the Zrok Install Guide

#### Scenario: Folder terminals route sets mobile depth to 1
- **WHEN** the current URL is `/folder/:encodedCwd/terminals` on a mobile viewport
- **THEN** `MobileShell` depth SHALL be 1 and the detail panel SHALL display the TerminalsView for the decoded cwd
