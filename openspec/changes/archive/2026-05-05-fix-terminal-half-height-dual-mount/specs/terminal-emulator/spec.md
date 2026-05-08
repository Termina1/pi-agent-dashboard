## ADDED Requirements

### Requirement: Server SHALL reject degenerate PTY resize messages
The terminal gateway SHALL ignore any inbound `{type:"resize", cols, rows}` control message where `cols < 2` or `rows < 2`. The PTY SHALL retain its previous dimensions. The connection SHALL remain open; no error frame is sent.

This guard is defense in depth: it prevents misbehaving clients (or transient `display:none` containers measured by FitAddon during route transitions) from corrupting `node-pty` geometry to a state where the shell renders into a 1×1 viewport.

A PTY at `cols < 2` or `rows < 2` is non-functional for every supported shell binding; no legitimate user intent maps to those dimensions.

#### Scenario: Resize with cols below floor is ignored
- **WHEN** an attached client sends `{type:"resize", cols: 1, rows: 24}`
- **THEN** the server SHALL NOT call `pty.resize(...)`
- **THEN** the PTY SHALL retain its previous cols and rows
- **THEN** the WebSocket connection SHALL remain open

#### Scenario: Resize with rows below floor is ignored
- **WHEN** an attached client sends `{type:"resize", cols: 80, rows: 0}`
- **THEN** the server SHALL NOT call `pty.resize(...)`
- **THEN** the PTY SHALL retain its previous cols and rows

#### Scenario: Resize at floor is accepted
- **WHEN** an attached client sends `{type:"resize", cols: 2, rows: 2}`
- **THEN** the server SHALL call `pty.resize(2, 2)`

#### Scenario: Normal resize is accepted
- **WHEN** an attached client sends `{type:"resize", cols: 80, rows: 24}`
- **THEN** the server SHALL call `pty.resize(80, 24)`
