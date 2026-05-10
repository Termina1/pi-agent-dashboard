## Context

The current `publish.yml` workflow uses a two-job setup (ci → publish) with a stored `NPM_TOKEN` secret. The pi-model-proxy project already uses a single-job OIDC-based workflow that extracts the version from the git tag and creates GitHub Releases. The package `@blackbelt-technology/pi-dashboard` has never been published to npm.

Key constraint: this project has a `prepare` script (`vite build`) and `node-pty` as a dependency, which requires native compilation. The GitHub Actions environment needs to handle both.

## Goals / Non-Goals

**Goals:**
- Match pi-model-proxy release workflow pattern (single job, OIDC, tag-version, GitHub Release)
- Eliminate stored npm secrets from GitHub repository
- Add provenance attestation for supply chain transparency
- Add missing LICENSE file
- Document the release process

**Non-Goals:**
- Changing the CI workflow (`ci.yml`) — it works fine as-is
- Automating the one-time npmjs.com setup (manual steps required)
- Setting up branch protection or release approval workflows
- Changing the package name or scope

## Decisions

### 1. Single-job publish workflow (matching pi-model-proxy)

Consolidate the current two-job workflow (ci + publish) into a single job. The two-job design added complexity (separate npm ci + build in each job) without benefit — if CI fails, the publish step won't run regardless.

**Alternative**: Keep two jobs with artifact passing. Rejected — unnecessary complexity for this use case.

### 2. OIDC trusted publishing (no NPM_TOKEN)

Use npm's trusted publishing via GitHub Actions OIDC. The workflow requests a short-lived token at publish time, scoped to the exact repository and workflow. Requires `id-token: write` permission and `--provenance` flag.

**Alternative**: Keep `NPM_TOKEN` secret. Rejected — long-lived tokens are a security risk, require rotation, and trusted publishing is now the npm-recommended approach.

### 3. Version extraction from git tag

Extract version from the git tag (`v1.0.0` → `1.0.0`) and set it via `npm version --no-git-tag-version`. This means `package.json` version doesn't need manual updates — the tag is the source of truth.

### 4. One-time manual first publish

Since the package doesn't exist on npm yet, a manual `npm publish` is needed before configuring trusted publishing (npm requires the package to exist first). After that, all future publishes go through GitHub Actions OIDC.

### 5. Node.js 22 (keep current)

Keep Node.js 22 as in the existing workflows. The pi-model-proxy uses Node 24, but this project has `node-pty` which benefits from staying on the LTS version already tested in CI.

## Risks / Trade-offs

- **[Risk] First manual publish requires org admin access** → Ensure someone with `@blackbelt-technology` npm org admin rights does the initial publish
- **[Risk] Trusted publisher misconfiguration fails silently** → npm doesn't validate the config when saved; errors only appear at publish time. Double-check org name, repo name, and workflow filename
- **[Risk] `node-pty` build failure in CI** → Already handled by existing CI workflow using Node.js 22 on ubuntu-latest; no change needed
- **[Trade-off] Single job means re-running build on publish** → Acceptable; the build is fast and the simplicity outweighs the minor time cost
