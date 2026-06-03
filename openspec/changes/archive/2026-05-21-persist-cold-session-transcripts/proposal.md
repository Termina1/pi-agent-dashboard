## Why

Opening an inactive session whose events were evicted from memory currently replays the full JSONL file as synthetic streaming events. Large sessions appear empty for minutes and then progressively rebuild, even though the transcript is already complete.

## What Changes

- Persist a per-session transcript snapshot sidecar next to each `.jsonl` file.
- Prewarm missing or stale snapshots in the background after server startup, newest sessions first.
- Serve cold inactive subscriptions from a single `session_snapshot` browser message instead of `event_replay` batches.
- Build a snapshot on demand if a user opens a cold session before prewarm finishes.
- Keep live and warm in-memory sessions on the existing event stream path.

## Capabilities

### New Capabilities

- `session-transcript-snapshots`: Durable transcript snapshots for cold inactive sessions, cold-subscribe snapshot delivery, and background prewarm.

### Modified Capabilities

- `shared-protocol`: Adds the `session_snapshot` server-to-browser message used to hydrate cold session state without event replay.

## Impact

Affected code:
- `packages/server/src/session-snapshot-store.ts` new snapshot read/write/build helpers.
- `packages/server/src/browser-handlers/subscription-handler.ts` cold-subscribe path.
- `packages/server/src/session-bootstrap.ts` or server startup wiring for background prewarm.
- `packages/shared/src/browser-protocol.ts` server-to-browser message type.
- `packages/client/src/hooks/useMessageHandler.ts` snapshot hydration.
- Tests for snapshot projection, protocol typing, cold subscribe behavior, and client hydration.

No new external dependencies. No JSONL format migration. Existing sessions without snapshots remain readable; the server builds snapshots from their existing JSONL files.
