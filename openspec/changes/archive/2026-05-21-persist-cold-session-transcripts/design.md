## Context

Inactive sessions leave the in-memory event buffer through restart or LRU eviction. When a browser opens one, `subscription-handler.ts` calls `directoryService.loadSessionEvents()`, which reads the full JSONL file, synthesizes dashboard events with `state-replay.ts`, and sends `event_replay` batches to the browser. The browser reducer rebuilds `ChatMessage[]` over many updates, so large sessions look empty and then appear to stream history.

The fastest fix is to persist finalized transcript projection beside each JSONL file and use it for cold inactive opens. Live sessions keep the current event pipeline.

## Goals / Non-Goals

**Goals:**

- Cold inactive sessions render from one persisted transcript snapshot.
- Opening old sessions avoids historical `event_replay` batching.
- Missing snapshots build before user clicks via background prewarm.
- First open of an unprewarmed session builds one snapshot, then sends one browser message.
- Existing live/warm event behavior remains unchanged.

**Non-Goals:**

- Replace BrowserGateway WebSocket with SSE.
- Build a JSONL byte-offset index.
- Solve `/tree` branch navigation.
- Perfectly preserve every live-only UI surface in snapshots.
- Change pi JSONL format.

## Decisions

### Per-session sidecar snapshot

Use `<session>.snapshot.json` next to `<session>.jsonl` and `<session>.meta.json`.

Rationale:
- Same invalidation boundary as the session file.
- No central database migration.
- Easy cleanup with existing session files.

Alternative: centralized snapshot store. Rejected because it adds migration and ownership complexity.

### Snapshot stores finalized transcript, not event log

Snapshot stores a browser-hydratable transcript state: messages, stats, model metadata, context usage, and flags. `streamingText` is omitted/empty.

Rationale:
- Directly fixes cold open latency and visual pseudo-streaming.
- Avoids replaying synthetic `message_update` / `message_end` events.

Alternative: persist event batches. Rejected because browser still must replay and progressively render history.

### Server projector is intentionally narrow

Create a server-side projector from JSONL entries to finalized transcript messages. It covers user, assistant text, tool calls/results, images, usage stats, and entry ids. It does not need every live-only reducer field.

Rationale:
- Minimal implementation.
- Cold inactive sessions need readable transcript first.
- Complex live flow/prompt state remains on existing warm/live path.

Alternative: move full client reducer into shared. Rejected for first pass because it expands scope and couples React-facing chat state to server runtime.

### Cold subscribe uses snapshot path only on memory miss

`handleSubscribe()` keeps the current branch when `eventStore.hasEvents(sessionId)` is true. Only the disk-load branch switches to snapshot read/build/send.

Rationale:
- Reduces regression risk for live sessions, pending prompts, flow runs, and tool updates.

### Background prewarm after scan

After startup session discovery, enqueue missing/stale snapshot builds sorted by recent activity. Use low concurrency, preferably 1, and do not block startup.

Rationale:
- Pays JSONL parse cost before user click.
- Avoids CPU spikes during startup.

### On-demand build promotes user-clicked session

If user opens a cold session before prewarm built its snapshot, build immediately for that session and send one `session_snapshot` after completion. Do not send partial replay while building.

Rationale:
- Removes visual historical streaming even on first cold open.

## Risks / Trade-offs

- Projector misses some existing reducer behavior → Start with transcript essentials; keep warm/live path unchanged; add tests for common message/tool/image cases.
- First ever open of very large unprewarmed session still waits for one parse → Prewarm newest sessions first; show existing loading state; subsequent opens are instant.
- Snapshot can go stale after live writes → Validate by JSONL size + mtime + projector version; enqueue refresh on `agent_end`.
- Snapshot writes add disk I/O → Use background queue and atomic tmp→rename writes.
- Large snapshots consume disk → Snapshot is bounded to finalized transcript content and replaces repeated replay work; no retention policy in first pass.

## Migration Plan

1. Add snapshot protocol and client hydration.
2. Add snapshot store/projector with tests.
3. Switch cold subscribe memory-miss path to snapshot read/build/send.
4. Add background prewarm and `agent_end` refresh enqueue.
5. Keep old event replay behavior for warm/live sessions.

Rollback: remove snapshot cold path and return to `directoryService.loadSessionEvents()` event replay. Snapshot files are ignored and can remain on disk.
