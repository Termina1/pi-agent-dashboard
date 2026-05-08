## MODIFIED Requirements

### Requirement: History navigation must not interfere with multiline editing or autocomplete

`ArrowUp` / `ArrowDown` key presses without modifier keys SHALL activate history navigation only when ALL of the following conditions are true:

1. No autocomplete dropdown is currently open (no `/`-command list, no `@`-file list).
2. No pending prompt is awaiting server response.
3. The caret is a single (non-selection) position.
4. The textarea's current text value is the empty string.
5. There are no pending image attachments staged in the input.

When any condition is false, the bare `ArrowUp` / `ArrowDown` event SHALL NOT be intercepted, and the textarea's native behavior (cursor movement between lines, or dropdown navigation) SHALL apply.

#### Scenario: Multiline editing is preserved
- **WHEN** the input contains "line one\nline two\nline three" and the caret is on "line two"
- **THEN** pressing `ArrowUp` SHALL move the caret to "line one" (native behavior), NOT trigger history recall

#### Scenario: Single-line draft cursor movement is preserved
- **WHEN** the input contains "fix the bug" and the caret is at any position
- **THEN** pressing `ArrowUp` SHALL leave the caret at its current column on the same (only) line per native textarea behavior, NOT trigger history recall

#### Scenario: Autocomplete dropdown takes priority
- **WHEN** the `/`-command dropdown is open and the user presses `ArrowUp`
- **THEN** the dropdown selection SHALL move (existing behavior), NOT history recall

#### Scenario: History activates on empty input
- **WHEN** the input is empty (no text, no pending images) and no autocomplete dropdown is open and no prompt is pending
- **THEN** pressing `ArrowUp` SHALL trigger history recall and populate the input with the most recent prompt

#### Scenario: History does not activate when only pending images are present
- **WHEN** the input has empty text but one or more pasted images attached
- **THEN** pressing `ArrowUp` SHALL NOT trigger history recall and SHALL NOT overwrite the staged image set

## ADDED Requirements

### Requirement: Force-history modifier shortcut

The chat input SHALL support an explicit force-history shortcut that activates history recall regardless of input content. Pressing `ArrowUp` or `ArrowDown` while either `Ctrl` or `Meta` (Cmd on macOS) is held SHALL trigger history recall, subject only to the autocomplete-not-open and no-pending-prompt gates from the bare-arrow rule. The current input content (text and pending images) SHALL be captured as the in-progress draft on first invocation, exactly as for the bare-arrow path, and SHALL be restored by the existing walk-past-newest, `Escape`, or session-switch paths.

#### Scenario: Ctrl+ArrowUp recalls history with text already in the input
- **WHEN** the input contains "half-typed" and the user presses `Ctrl+ArrowUp` (no autocomplete dropdown open, no pending prompt)
- **THEN** the input SHALL be replaced with the most recent prompt from session history AND "half-typed" SHALL be preserved as the in-progress draft for later restoration

#### Scenario: Cmd+ArrowUp on macOS recalls history with text already in the input
- **WHEN** the input contains "half-typed" and the user presses `Cmd+ArrowUp` (no autocomplete dropdown open, no pending prompt)
- **THEN** the input SHALL be replaced with the most recent prompt from session history AND "half-typed" SHALL be preserved as the in-progress draft

#### Scenario: Ctrl+ArrowDown walks forward in history
- **WHEN** the input is showing history entry `N` (N > 0) after a force-history activation and the user presses `Ctrl+ArrowDown`
- **THEN** the input SHALL be populated with history entry `N - 1` (the next newer prompt)

#### Scenario: Walking past newest with force-history restores the in-progress draft
- **WHEN** the user is at the newest history entry after entering history mode via `Ctrl+ArrowUp` from "half-typed" and presses `Ctrl+ArrowDown` (or bare `ArrowDown`)
- **THEN** the input SHALL contain "half-typed" and history mode SHALL be exited

#### Scenario: Force-history is suppressed while autocomplete is open
- **WHEN** the `/`-command dropdown is open and the user presses `Ctrl+ArrowUp`
- **THEN** the dropdown selection SHALL move (or the event SHALL be passed through), and history recall SHALL NOT be triggered

#### Scenario: Force-history is suppressed while a prompt is pending
- **WHEN** a prompt is awaiting server response and the user presses `Ctrl+ArrowUp`
- **THEN** history recall SHALL NOT be triggered (matches bare-arrow gating)

#### Scenario: Pending images are preserved when entering force-history
- **WHEN** the input has empty text but a pasted image attached, and the user presses `Ctrl+ArrowUp`
- **THEN** the input text SHALL be replaced with the most recent history entry AND the pending images SHALL remain attached to the input
