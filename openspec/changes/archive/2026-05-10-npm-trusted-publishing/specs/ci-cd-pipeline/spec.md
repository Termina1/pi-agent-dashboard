## MODIFIED Requirements

### Requirement: Publish workflow on version tags
The project SHALL have a GitHub Actions workflow (`.github/workflows/publish.yml`) that triggers when a tag matching `v*` is pushed. The workflow SHALL use a single job that runs CI checks (lint, test, build), extracts the version from the git tag, publishes the package to npm via OIDC trusted publishing with provenance, and creates a GitHub Release with auto-generated notes.

#### Scenario: Version tag triggers publish
- **WHEN** a tag matching `v*` (e.g., `v1.0.0`) is pushed
- **THEN** the publish workflow SHALL run lint, test, build, and then publish to npm and create a GitHub Release

#### Scenario: Version extracted from git tag
- **WHEN** the publish workflow runs for tag `v1.2.3`
- **THEN** it SHALL extract `1.2.3` from the tag and set it in `package.json` via `npm version "1.2.3" --no-git-tag-version --allow-same-version` before publishing

#### Scenario: Publish uses OIDC trusted publishing
- **WHEN** the publish step runs
- **THEN** it SHALL authenticate to npm via OIDC (OpenID Connect) without any stored secrets, requiring `id-token: write` permission in the workflow

#### Scenario: CI failure prevents publish
- **WHEN** lint, test, or build fails during the publish workflow
- **THEN** the npm publish step SHALL NOT execute

#### Scenario: GitHub Release created
- **WHEN** the package is successfully published to npm
- **THEN** the workflow SHALL create a GitHub Release using `softprops/action-gh-release@v2` with auto-generated release notes, requiring `contents: write` permission

### Requirement: npm provenance
The publish workflow SHALL use the `--provenance` flag when publishing to npm to provide supply chain transparency.

#### Scenario: Package published with provenance
- **WHEN** the package is published to npm
- **THEN** the published package SHALL include provenance attestation linking it to the source commit and GitHub Actions build

### Requirement: Node.js version
Both CI and publish workflows SHALL use Node.js 22 as the runtime version.

#### Scenario: Node 22 used in CI
- **WHEN** the CI workflow runs
- **THEN** it SHALL set up Node.js 22 using `actions/setup-node`

## ADDED Requirements

### Requirement: MIT LICENSE file
The repository SHALL contain a `LICENSE` file at the root with the MIT license text. The `package.json` `files` array SHALL include `LICENSE`.

#### Scenario: LICENSE file exists
- **WHEN** the package is published to npm
- **THEN** the published tarball SHALL include a `LICENSE` file with MIT license text

### Requirement: Trusted publisher configuration on npmjs.com
The npm package SHALL be configured with GitHub Actions as a trusted publisher on npmjs.com, linking the `@blackbelt-technology` org, `pi-agent-dashboard` repository, and `publish.yml` workflow filename.

#### Scenario: Trusted publisher configured
- **WHEN** the GitHub Actions workflow publishes via OIDC
- **THEN** npmjs.com SHALL accept the publish request based on the trusted publisher configuration matching the repository and workflow

## REMOVED Requirements

### Requirement: Publish uses NPM_TOKEN secret
**Reason**: Replaced by OIDC trusted publishing — short-lived tokens minted at publish time eliminate the need for stored secrets.
**Migration**: Delete `NPM_TOKEN` from GitHub repository secrets after trusted publishing is verified working.
