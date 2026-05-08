## MODIFIED Requirements

### Requirement: WhatsNewDialog modal
The client SHALL provide a `WhatsNewDialog` React component that renders parsed changelog entries between two versions of a package as a modal dialog. The dialog SHALL render whether or not the changelog contains breaking changes; only the auto-expansion behaviour of the Breaking section is conditional on `hasBreaking`.

#### Scenario: Dialog mounts via DialogPortal
- **WHEN** the dialog is opened
- **THEN** it SHALL render through the existing `DialogPortal` component
- **AND** SHALL trap focus while open
- **AND** SHALL close on Esc, click-outside, and the explicit `[×]` button

#### Scenario: Breaking section auto-expanded only when hasBreaking is true
- **WHEN** the dialog opens with `hasBreaking: true`
- **THEN** the "Breaking Changes" section SHALL be the first content block beneath the title
- **AND** SHALL be expanded by default
- **AND** SHALL list every breaking-change bullet across every release in the response, grouped by version
- **WHEN** the dialog opens with `hasBreaking: false`
- **THEN** the "Breaking Changes" section SHALL NOT be rendered
- **AND** the dialog content SHALL begin with the New features and Other changes sections

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
