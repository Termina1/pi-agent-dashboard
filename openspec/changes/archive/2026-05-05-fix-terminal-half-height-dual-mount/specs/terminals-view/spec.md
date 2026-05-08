## ADDED Requirements

### Requirement: Single mounted TerminalView per terminal id
At any time, the React tree SHALL contain at most one mounted `<TerminalView>` instance per terminal id. The `<TerminalsView>` tabbed container SHALL be the only owner of `<TerminalView>` mounting; no parallel keep-alive list of `<TerminalView>` instances SHALL exist elsewhere in the App tree.

The single-mount invariant prevents duplicate `WebSocket /ws/terminal/:id` connections, duplicate `AttachAddon` instances, and competing FitAddon resize messages — the latter being the root cause of the half-height-rendering regression.

#### Scenario: Folder-terminals page mounts each terminal exactly once
- **WHEN** the user is on `/folder/:encodedCwd/terminals` for a folder containing N terminals
- **THEN** the document SHALL contain exactly N `<TerminalView>` React subtrees (one per terminal)
- **THEN** the document SHALL contain exactly N `.xterm` DOM elements
- **THEN** the server-side `entry.clients` Set SHALL hold exactly one WebSocket per terminal id (one per connected browser tab)

#### Scenario: Navigation away from folder-terminals page tears down xterm instances
- **WHEN** the user navigates from `/folder/:encodedCwd/terminals` to any non-terminal route
- **THEN** all `<TerminalView>` instances under that `<TerminalsView>` SHALL unmount
- **THEN** the underlying PTYs SHALL remain alive on the server
- **THEN** the server's ringbuffer SHALL retain the last 256 KB of output for replay on return

#### Scenario: Return to folder-terminals page replays from server ringbuffer
- **WHEN** the user navigates back to `/folder/:encodedCwd/terminals` after leaving
- **THEN** `<TerminalsView>` SHALL re-mount one `<TerminalView>` per terminal in the folder
- **THEN** each `<TerminalView>` SHALL receive the server-side ringbuffer replay on its new WebSocket connection
- **THEN** xterm SHALL render the replayed output without persistent scrollback from before the navigation

#### Scenario: Switching tabs within the folder preserves PTY and scrollback
- **WHEN** the user clicks a different terminal tab within the same folder
- **THEN** the previously visible `<TerminalView>` SHALL toggle to `display: none` (not unmount)
- **THEN** the newly active `<TerminalView>` SHALL toggle to `display: flex`
- **THEN** scrollback in both terminals SHALL be preserved across the switch
