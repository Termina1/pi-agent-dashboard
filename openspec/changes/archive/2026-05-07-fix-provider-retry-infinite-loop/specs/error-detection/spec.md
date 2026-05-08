## MODIFIED Requirements

### Requirement: Error extraction from agent_end events
The event reducer SHALL inspect `agent_end` events for error information. When `data.messages` contains a final assistant message with `stopReason === "error"`, the reducer SHALL set `lastError` on `SessionState` with the `errorMessage` value and the event timestamp.

`lastError` SHALL only be set when pi-coding-agent has fully exhausted its auto-retry attempts (i.e. the assistant message with `stopReason: "error"` reaches `agent_end` AS the terminal message). Transient retryable errors that pi-coding-agent retries internally SHALL NOT set `lastError`; they are surfaced to the user via `SessionState.retryState` instead (see `provider-retry-state`).

`lastError` MAY also be set early by the `auto_retry_end` arm when `success: false` and a `finalError` is supplied AND `lastError` is currently undefined; this lets the UI surface terminal cause from an aborted retry without waiting for the upstream `agent_end`.

#### Scenario: LLM provider returns quota exceeded error after retries exhausted
- **WHEN** an `agent_end` event arrives with the last message having `stopReason: "error"` and `errorMessage: "Rate limit exceeded"`
- **THEN** `SessionState.lastError` SHALL be set to `{ message: "Rate limit exceeded", timestamp: <event timestamp> }`
- **AND** `SessionState.status` SHALL be `"idle"`
- **AND** `SessionState.isStreaming` SHALL be `false`
- **AND** `SessionState.retryState` SHALL be cleared

#### Scenario: agent_end without error
- **WHEN** an `agent_end` event arrives with the last message having `stopReason: "end_turn"` (normal completion)
- **THEN** `SessionState.lastError` SHALL remain unchanged (not set)

#### Scenario: agent_end with missing or empty messages array
- **WHEN** an `agent_end` event arrives with no `messages` array or an empty array
- **THEN** `SessionState.lastError` SHALL remain unchanged (defensive fallback)

#### Scenario: usage-limit pattern produces immediate terminal state
- **WHEN** an `agent_end` event arrives whose terminal `errorMessage` matches `/usage[_ ]limit[_ ]reached|usage_not_included|quota[_ ]exceeded|monthly limit|hourly limit/i`
- **AND** `SessionState.retryState` is currently set (a retry banner was visible)
- **THEN** the bridge SHALL have already synthesized an `auto_retry_end { success: false }` BEFORE this `agent_end` (per `provider-retry-state`)
- **AND** `SessionState.retryState` SHALL be cleared
- **AND** `SessionState.lastError` SHALL be set to the errorMessage

#### Scenario: auto_retry_end with finalError populates lastError early when undefined
- **WHEN** `SessionState.lastError` is undefined
- **AND** an `auto_retry_end` event arrives with `data: { success: false, finalError: "Rate limit exceeded" }`
- **THEN** `SessionState.lastError` SHALL be set to `{ message: "Rate limit exceeded", timestamp: <event.timestamp> }`

#### Scenario: auto_retry_end finalError does not overwrite existing lastError
- **WHEN** `SessionState.lastError` is already set to a previous error
- **AND** an `auto_retry_end` event arrives with `success: false` and a `finalError`
- **THEN** `SessionState.lastError` SHALL NOT be overwritten
