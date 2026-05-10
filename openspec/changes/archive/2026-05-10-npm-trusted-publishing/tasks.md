## 1. Repository Files

- [ ] 1.1 Create MIT `LICENSE` file at repository root
- [ ] 1.2 Add `LICENSE` to the `files` array in `package.json`

## 2. Publish Workflow

- [ ] 2.1 Rewrite `.github/workflows/publish.yml` to single-job pattern: checkout, setup-node with registry-url, extract version from tag, npm version, npm ci, lint, test, build, npm publish with `--provenance --access public`, GitHub Release via `softprops/action-gh-release@v2`
- [ ] 2.2 Set permissions to `contents: write` and `id-token: write`
- [ ] 2.3 Remove `NODE_AUTH_TOKEN` / `NPM_TOKEN` secret reference

## 3. First Publish (Manual)

- [ ] 3.1 Run `npm login` (must have `@blackbelt-technology` org admin access)
- [ ] 3.2 Run `npm publish --access public` to create the package on npmjs.com
- [ ] 3.3 Verify package exists at https://www.npmjs.com/package/@blackbelt-technology/pi-dashboard

## 4. Trusted Publisher Setup (npmjs.com)

- [ ] 4.1 Go to package Settings → Trusted Publisher → GitHub Actions
- [ ] 4.2 Configure: org=`blackbelt-technology`, repo=`pi-agent-dashboard`, workflow=`publish.yml`, environment=_(empty)_
- [ ] 4.3 (Recommended) Restrict publishing access to "Require 2FA and disallow tokens"

## 5. Verification

- [ ] 5.1 Push changes to main, create and push a `v*` tag (e.g., `v0.2.0`)
- [ ] 5.2 Verify GitHub Actions workflow completes successfully
- [ ] 5.3 Verify package published on npm with provenance badge
- [ ] 5.4 Verify GitHub Release created with auto-generated notes
- [ ] 5.5 Delete `NPM_TOKEN` secret from GitHub repository settings (if it exists)
