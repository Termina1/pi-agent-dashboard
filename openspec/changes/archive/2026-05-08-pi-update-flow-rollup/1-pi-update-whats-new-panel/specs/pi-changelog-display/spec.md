## ADDED Requirements

### Requirement: CHANGELOG parser
The dashboard server SHALL provide a pure parser that converts a Keep-a-Changelog-style markdown file into a structured list of release entries with typed sub-sections.

#### Scenario: H2 release headers extracted
- **WHEN** the parser is given markdown text containing one or more lines matching `^## \[<version>\] - <date>$`
- **THEN** the parser SHALL emit one `ChangelogRelease` per matched H2
- **AND** populate `version` from the bracketed token
- **AND** populate `date` from the date token, or `null` when the token is not a parseable ISO-like date

#### Scenario: Breaking Changes section extracted
- **WHEN** a release section contains an `### Breaking Changes` H3 sub-heading
- **THEN** the parser SHALL collect every top-level `- ` bullet under that sub-heading into the release's `breaking` array
- **AND** stop collecting when the next H2 or H3 boundary is reached
- **AND** preserve each bullet's original prose verbatim, including inline markdown links

#### Scenario: New features merged from two section names
- **WHEN** a release section contains `### New Features` AND/OR `### Added`
- **THEN** the parser SHALL append bullets from both sub-headings into the release's `features` array in source order

#### Scenario: Other typed sub-sections preserved
- **WHEN** a release section contains `### Changed` or `### Fixed`
- **THEN** the parser SHALL populate `changed` or `fixed` arrays respectively

#### Scenario: Issue links extracted per bullet
- **WHEN** a bullet's prose contains substrings matching `\(\[#(\d+)\]\((https?://[^)]+)\)\)`
- **THEN** the parser SHALL append `{ num, url }` entries to that bullet's `issues` array
- **AND** still preserve the original prose unchanged

#### Scenario: Raw H2 section retained
- **WHEN** any release is parsed
- **THEN** the parser SHALL set the release's `raw` field to the full markdown text from that release's H2 line through (but not including) the next H2 line

#### Scenario: Unrecognized sub-headings ignored
- **WHEN** a release section contains H3 sub-headings other than the four recognized names
- **THEN** the parser SHALL NOT throw
- **AND** the typed arrays SHALL remain empty for those bullets
- **AND** `raw` SHALL still contain the full section text

#### Scenario: Malformed markdown handled gracefully
- **WHEN** the parser is given markdown that does not contain any matching H2 release headers
- **THEN** the parser SHALL return an empty release list
- **AND** SHALL NOT throw

### Requirement: Changelog REST endpoint
The server SHALL expose `GET /api/pi-core/changelog` returning structured release entries between two versions for an installed core package.

#### Scenario: Successful range query
- **WHEN** the client sends `GET /api/pi-core/changelog?pkg=@mariozechner/pi-coding-agent&from=0.62.0&to=0.70.0`
- **AND** the package is installed AND its `CHANGELOG.md` is readable
- **THEN** the server SHALL respond `200` with a JSON body containing `pkg`, `from`, `to`, `releases[]` (latest first), `hasBreaking`, `changelogUrl`, and `parsedAt`
- **AND** `releases[]` SHALL contain only entries whose version falls in the half-open interval `(from, to]`

#### Scenario: hasBreaking derived from releases
- **WHEN** any release in the filtered list has a non-empty `breaking[]`
- **THEN** `hasBreaking` SHALL be `true`
- **AND** otherwise `false`

#### Scenario: Package not in core whitelist rejected
- **WHEN** the client sends a request with a `pkg` query param that is not in the core-package whitelist
- **THEN** the server SHALL respond `400` with a JSON error
- **AND** SHALL NOT read any filesystem path derived from the user input

#### Scenario: Package not installed returns empty
- **WHEN** the requested package is in the whitelist BUT its `CHANGELOG.md` cannot be located
- **THEN** the server SHALL respond `200` with `releases: []`, `hasBreaking: false`, `changelogUrl: null`
- **AND** SHALL NOT respond `404`

#### Scenario: Missing or invalid version range
- **WHEN** the client omits `from` or `to`, or provides versions that are not parseable semver
- **THEN** the server SHALL respond `400` with a JSON error

#### Scenario: Endpoint gated by bootstrap status
- **WHEN** `bootstrapState.status !== "ready"`
- **THEN** the server SHALL respond `503` (mirroring the gate that protects other `/api/pi-core/*` routes)

#### Scenario: Cache hit on identical request
- **WHEN** the same request is made twice within 60 seconds
- **AND** the underlying `CHANGELOG.md` mtime has not changed
- **THEN** the second request SHALL be served from cache without re-parsing

#### Scenario: Cache invalidated by core update
- **WHEN** a `pi-core` update completes successfully via `POST /api/pi-core/update`
- **THEN** the changelog cache for the updated package SHALL be cleared
- **AND** the next `GET /api/pi-core/changelog` request for that package SHALL re-parse from disk

### Requirement: Changelog URL derivation
The server SHALL derive a public `changelogUrl` for the GitHub-hosted CHANGELOG when the installed package's `package.json` declares a `repository` field with a parseable GitHub URL.

#### Scenario: GitHub repository URL parsed
- **WHEN** the package's `package.json` declares `repository` as either a string `"github:org/repo"` or `"https://github.com/org/repo.git"`, or an object `{ "url": "git+https://github.com/org/repo.git" }`
- **THEN** the server SHALL set `changelogUrl` to `https://github.com/org/repo/blob/main/CHANGELOG.md`

#### Scenario: Non-GitHub repository
- **WHEN** the `repository` field is missing OR points at a non-GitHub host
- **THEN** the server SHALL set `changelogUrl` to `null`

#### Scenario: Monorepo subdir respected
- **WHEN** the `repository` field includes a `directory` sub-field (e.g. `"directory": "packages/foo"`)
- **THEN** the server SHALL include the subdir in the URL: `https://github.com/org/repo/blob/main/packages/foo/CHANGELOG.md`

### Requirement: WhatsNewDialog modal
The client SHALL provide a `WhatsNewDialog` React component that renders parsed changelog entries between two versions of a package as a modal dialog.

#### Scenario: Dialog mounts via DialogPortal
- **WHEN** the dialog is opened
- **THEN** it SHALL render through the existing `DialogPortal` component
- **AND** SHALL trap focus while open
- **AND** SHALL close on Esc, click-outside, and the explicit `[×]` button

#### Scenario: Breaking changes pinned at top
- **WHEN** the dialog opens with `hasBreaking: true`
- **THEN** the "Breaking Changes" section SHALL be the first content block beneath the title
- **AND** SHALL be expanded by default
- **AND** SHALL list every breaking-change bullet across every release in the response, grouped by version

#### Scenario: Other sections collapsed
- **WHEN** the dialog renders the "New features" and "Other changes" sections (the latter aggregating `changed` + `fixed`)
- **THEN** both SHALL be collapsed by default with an expand toggle
- **AND** clicking the toggle SHALL expand the section in place

#### Scenario: Bullet links preserved
- **WHEN** any bullet contains a markdown link (issue/PR or otherwise)
- **THEN** the dialog SHALL render that link as a clickable anchor opening in a new tab
- **AND** the rendered HTML SHALL pass through the existing `MarkdownContent` component's link sanitization

#### Scenario: GitHub link rendered when available
- **WHEN** `changelogUrl` is non-null
- **THEN** the dialog SHALL render a footer link "Open full changelog on GitHub" pointing at that URL
- **AND** open it in a new tab

#### Scenario: Empty release list shown
- **WHEN** `releases: []` is returned (e.g. from === to, or bridge of two non-adjacent published versions)
- **THEN** the dialog SHALL render a one-line message "No release notes available for this version range"
- **AND** still render the "Open full changelog" link if available

#### Scenario: Update CTA invokes existing handler
- **WHEN** the user clicks `[Update to <latest>]` in the dialog footer
- **THEN** the dialog SHALL close
- **AND** the handler SHALL invoke the same `onUpdate` callback the row's `[Update]` button uses, with the same package name argument
