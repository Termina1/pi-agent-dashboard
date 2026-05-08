## ADDED Requirements

### Requirement: Folder section renders pending spinner when slow poll in flight

When the OpenSpec data for a folder has `pending: true` and is not yet
initialized, the folder header SHALL render a small grey spinner in
place of the usual `OPENSPEC (N CHANGES)` label, indicating to the
user that OpenSpec is detected for this folder and content is loading.
No expand chevron, Refresh, Archive, or Specs buttons SHALL render
while pending. The spinner SHALL inherit the same muted text colour
as the OpenSpec label so it does not draw attention away from active
session cards.

#### Scenario: Folder with openspec dir, slow poll pending

- **WHEN** a folder group is rendered for cwd `/project/foo` and
  `openspecMap.get("/project/foo")` returns
  `{ initialized: false, pending: true, changes: [] }`
- **THEN** the folder header SHALL render a small grey spinner where
  the `OPENSPEC (N CHANGES)` label would normally appear
- **AND** the Refresh, Archive, and Specs buttons SHALL NOT render
- **AND** the chevron SHALL NOT render
- **AND** the section SHALL NOT be expandable

#### Scenario: Folder with openspec dir transitions from pending to ready

- **WHEN** a `pending: true` spinner is showing and an
  `openspec_update` arrives for the same cwd with
  `{ initialized: true, changes: [...] }`
- **THEN** the spinner SHALL be replaced by the standard collapsed
  header (`▶ OPENSPEC (N CHANGES)` + Refresh + Archive + Specs)
  without layout shift

#### Scenario: Folder without openspec dir never spins

- **WHEN** a folder group is rendered for cwd `/project/foo` and
  `openspecMap.get("/project/foo")` returns
  `{ initialized: false, pending: false, changes: [] }`
- **THEN** no folder OpenSpec section SHALL render
- **AND** no spinner SHALL be visible at any point

## MODIFIED Requirements

### Requirement: Folder group header shows OpenSpec section
Each folder group in the session list SHALL render a `FolderOpenSpecSection` component in the folder header, below git info and above editor/spawn buttons, when OpenSpec data for that directory is either `initialized: true` or `pending: true`.

#### Scenario: Directory with initialized OpenSpec
- **WHEN** a folder group is rendered for cwd `/project/foo` and OpenSpec data for that cwd has `initialized: true`
- **THEN** a `FolderOpenSpecSection` SHALL be rendered in the folder header showing the standard collapsed header

#### Scenario: Directory with openspec dir but slow poll pending
- **WHEN** a folder group is rendered for cwd `/project/foo` and OpenSpec data has `initialized: false` and `pending: true`
- **THEN** a `FolderOpenSpecSection` SHALL be rendered in the folder header showing the grey loading spinner (no buttons, no chevron)

#### Scenario: Directory without OpenSpec
- **WHEN** a folder group is rendered for cwd `/project/foo` and OpenSpec data has `initialized: false` and `pending: false` (or is not available)
- **THEN** no OpenSpec section SHALL be rendered in the folder header

#### Scenario: Pinned directory with no sessions
- **WHEN** a pinned directory has OpenSpec data but no active sessions
- **THEN** the `FolderOpenSpecSection` SHALL still be rendered showing change list and folder-level actions
