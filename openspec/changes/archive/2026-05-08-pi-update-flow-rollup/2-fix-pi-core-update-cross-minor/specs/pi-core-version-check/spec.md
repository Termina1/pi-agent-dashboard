## MODIFIED Requirements

### Requirement: Core package update execution
The server SHALL expose `POST /api/pi-core/update` to update one or more core packages. Updates SHALL always target the npm `latest` dist-tag regardless of the consuming `package.json` dependency range.

#### Scenario: Update global package
- **WHEN** a client calls `POST /api/pi-core/update` with `{ packages: ["@mariozechner/pi-coding-agent"] }` and the package has `installSource: "global"`
- **THEN** the server SHALL run `npm install -g @mariozechner/pi-coding-agent@latest`
- **AND** broadcast progress events via WebSocket

#### Scenario: Update managed package
- **WHEN** a package has `installSource: "managed"`
- **THEN** the server SHALL run `npm install <pkg>@latest` in the `~/.pi-dashboard/` directory
- **AND** the consuming `~/.pi-dashboard/package.json` dependency range SHALL be rewritten to reflect the freshly installed version (npm default behaviour)

#### Scenario: Update crosses minor-version boundary
- **WHEN** the installed version is in a different minor than the npm `latest` dist-tag (e.g. installed `0.70.6`, latest `0.73.1`)
- **AND** the consuming `package.json` declares the dependency with a caret range (e.g. `^0.70.0`)
- **THEN** the server SHALL still successfully install the `latest` version
- **AND** the post-update `installedVersion` reported by `PiCoreChecker` SHALL match the npm `latest`

#### Scenario: Update all packages
- **WHEN** `POST /api/pi-core/update` is called with `{ packages: [] }` or no `packages` field
- **THEN** all packages with `updateAvailable: true` SHALL be updated sequentially
- **AND** each SHALL use the `npm install <pkg>@latest` argv shape

#### Scenario: Concurrent operation blocked
- **WHEN** a package operation (extension install/update or core update) is already running
- **THEN** the server SHALL return 409 Conflict

#### Scenario: Permission error on global update
- **WHEN** `npm install -g <pkg>@latest` fails with a permission error (EACCES / EPERM / EROFS)
- **THEN** the error message SHALL be surfaced to the client
- **AND** SHALL include a remediation hint that references `sudo npm install -g <pkg>@latest` (NOT `sudo npm update -g`)
