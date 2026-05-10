## Why

The current publish workflow uses a long-lived `NPM_TOKEN` secret for npm authentication, doesn't extract the version from the git tag (relying on whatever is in `package.json`), and doesn't create a GitHub Release. The pi-model-proxy project already uses OIDC-based trusted publishing — this change brings the same secure, streamlined release process to pi-agent-dashboard, eliminating stored secrets and adding automatic GitHub Releases.

## What Changes

- Replace `NPM_TOKEN` secret-based authentication in `publish.yml` with OIDC trusted publishing (no stored secrets)
- Add version extraction from git tag so `package.json` version is set automatically at publish time
- Consolidate CI + publish into a single job (matching pi-model-proxy pattern)
- Add `softprops/action-gh-release@v2` step to create GitHub Releases with auto-generated notes
- Remove `NODE_AUTH_TOKEN` environment variable from the publish step
- Add MIT `LICENSE` file (referenced in `package.json` `files` but missing)
- Add `LICENSE` to the `files` array in `package.json`
- Document the one-time npmjs.com trusted publisher setup and tag-driven release process

## Capabilities

### New Capabilities

_(none — no new runtime capabilities)_

### Modified Capabilities

- `ci-cd-pipeline`: Publish workflow switches from NPM_TOKEN to OIDC trusted publishing, adds version extraction from git tag, consolidates to single job, adds GitHub Release creation, and requires MIT LICENSE file

## Impact

- **`.github/workflows/publish.yml`**: Rewritten to match pi-model-proxy release pattern (single job, OIDC, version extraction, GitHub Release)
- **`LICENSE`**: New MIT license file added to repository root
- **`package.json`**: `LICENSE` added to `files` array
- **`openspec/specs/ci-cd-pipeline/spec.md`**: Updated requirements for trusted publishing
- **npmjs.com**: One-time manual first publish + trusted publisher configuration required
- **GitHub repository secrets**: `NPM_TOKEN` secret can be deleted after migration
- **No runtime code changes**: Purely CI/CD and packaging
