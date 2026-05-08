## MODIFIED Requirements

### Requirement: EventBus catch-all via emit intercept
The bridge extension SHALL wrap `pi.events.emit` to intercept all EventBus emissions. For every emission, the bridge SHALL forward an `event_forward` message to the dashboard server, EXCEPT when the emission is detected as an RPC-shape probe per the rules below. The original `emit` function SHALL ALWAYS be called regardless of the forwarding decision.

The intercept SHALL apply a rename mapping for known channels:
- `flow:flow-started` → `flow_started`
- `flow:agent-started` → `flow_agent_started`
- `flow:agent-complete` → `flow_agent_complete`
- `flow:subagent-tool-call` → `flow_tool_call`
- `flow:subagent-tool-result` → `flow_tool_result`
- `flow:assistant-text` → `flow_assistant_text`
- `flow:thinking-text` → `flow_thinking_text`
- `flow:loop-iteration` → `flow_loop_iteration`
- `flow:auto-decision` → `flow_auto_decision`
- `flow:complete` → `flow_complete`
- `subagents:created` → `subagent_created`
- `subagents:started` → `subagent_started`
- `subagents:completed` → `subagent_completed`
- `subagents:failed` → `subagent_failed`

For unknown channels (not in the mapping), the channel name SHALL be used directly as the `eventType`.

#### Scenario: Known flow event forwarded with mapped name
- **WHEN** `pi.events.emit("flow:flow-started", data)` is called and `data` is unchanged after handlers run
- **THEN** the bridge SHALL forward an `event_forward` with `eventType: "flow_started"`

#### Scenario: Known subagent event forwarded with mapped name
- **WHEN** `pi.events.emit("subagents:created", data)` is called and `data` is unchanged after handlers run
- **THEN** the bridge SHALL forward an `event_forward` with `eventType: "subagent_created"`

#### Scenario: Unknown custom extension event forwarded with channel name
- **WHEN** `pi.events.emit("my-extension:custom-event", data)` is called and `data` is unchanged after handlers run
- **THEN** the bridge SHALL forward an `event_forward` with `eventType: "my-extension:custom-event"`

#### Scenario: Events not forwarded before session is ready
- **WHEN** an EventBus emission occurs before `sessionReady` is true
- **THEN** the bridge SHALL NOT forward it (original emit still called)

#### Scenario: Original emit always called
- **WHEN** the bridge intercepts an EventBus emission
- **THEN** the original `emit` function SHALL always be called, regardless of forwarding success or RPC-skip decision

## ADDED Requirements

### Requirement: RPC-shape emissions are not forwarded
The bridge `pi.events.emit` wrapper SHALL detect synchronous RPC-style emissions — where a handler mutates the data argument as a return channel — and skip `event_forward` for them. Detection SHALL be performed by snapshotting the data argument before calling the original `emit` and comparing against a snapshot taken after.

A snapshot SHALL capture, for object data, the sorted key set and a shallow JSON hash of own enumerable properties (capped at 4096 chars). For non-object data (primitives, `null`, `undefined`), the snapshot SHALL be the value itself. Two snapshots are equal iff their kind and content are identical.

When the post-emit snapshot differs from the pre-emit snapshot, the emission SHALL be classified as RPC and SHALL NOT be forwarded.

#### Scenario: RPC probe with empty input filled by handler is skipped
- **WHEN** `pi.events.emit("flow:list-flows", {})` is called and a handler sets `data.flows = [...]` synchronously
- **THEN** the bridge SHALL NOT send an `event_forward` for this emission
- **AND** the original `emit` SHALL still be called (probe is populated for the caller)

#### Scenario: RPC probe with seed input mutated by handler is skipped
- **WHEN** `pi.events.emit("flow:role-set", { role: "x", modelId: "y" })` is called and a handler sets `data.success = true`
- **THEN** the bridge SHALL NOT send an `event_forward` for this emission

#### Scenario: Broadcast emission with read-only handlers is forwarded
- **WHEN** `pi.events.emit("flow:agent-started", { agent, model })` is called and handlers do not mutate `data`
- **THEN** the bridge SHALL forward an `event_forward` with the mapped event type

#### Scenario: Broadcast emission with non-object payload is forwarded
- **WHEN** `pi.events.emit("legacy:event", "string-payload")` or `pi.events.emit("legacy:event", null)` is called
- **THEN** the bridge SHALL forward the emission (non-object data cannot be mutated as a probe)

#### Scenario: Snapshot helper failure forwards conservatively
- **WHEN** the snapshot helper throws (e.g., on a value with a throwing getter)
- **THEN** the bridge SHALL forward the emission rather than silently dropping it

### Requirement: Listener-count fast-path forces forwarding when no handlers exist
When `pi.events.listenerCount(channel)` is available and returns `0`, the bridge SHALL forward the emission without performing snapshot-based RPC detection. An emission with no registered handlers cannot be RPC by definition (no handler can mutate the probe).

If `pi.events.listenerCount` is not a function (older pi-core), the bridge SHALL fall back to the snapshot-based detection path.

#### Scenario: Listener count zero forwards unconditionally
- **WHEN** `pi.events.emit("custom:ping", {})` is called and `pi.events.listenerCount("custom:ping") === 0`
- **THEN** the bridge SHALL forward the emission without snapshotting

#### Scenario: Missing listenerCount falls back to snapshot path
- **WHEN** `pi.events.listenerCount` is `undefined`
- **THEN** the bridge SHALL use snapshot-based detection for every emission

### Requirement: Async-dispatch suspicion triggers warn-once and conservative forwarding
The RPC-shape heuristic depends on pi-core's synchronous handler dispatch — handlers must complete before `origEventsEmit` returns so that probe mutations are visible at snapshot time. If the original `emit` returns a thenable (Promise-like value), the bridge SHALL emit a one-time `console.warn` indicating the assumption may be violated, and SHALL forward the emission conservatively (no skip) for that call and all subsequent calls in the session.

#### Scenario: Promise return triggers warning
- **WHEN** `origEventsEmit(channel, data)` returns a value with a `.then` method
- **THEN** the bridge SHALL log a single warning the first time this is observed
- **AND** the emission SHALL be forwarded regardless of snapshot comparison

#### Scenario: Subsequent async emissions do not re-warn
- **WHEN** a thenable return has already triggered the warning earlier in the session
- **THEN** subsequent thenable returns SHALL NOT re-log the warning
