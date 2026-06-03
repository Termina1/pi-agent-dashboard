## 1. Protocol and Types

- [x] 1.1 Add `SessionSnapshotMessage` and snapshot/transcript types to `packages/shared/src/browser-protocol.ts`.
- [x] 1.2 Add client handler for `session_snapshot` in `packages/client/src/hooks/useMessageHandler.ts`.
- [x] 1.3 Add a unit test proving snapshot hydration replaces one session state atomically and leaves `streamingText` empty.

## 2. Snapshot Store and Projector

- [x] 2.1 Add `packages/server/src/session-snapshot-store.ts` with sidecar path, atomic read/write, freshness validation, and current version constants.
- [x] 2.2 Implement JSONL-entry → transcript snapshot projector for user messages, assistant text, tool calls/results, images, stats, model metadata, context usage, and entry ids.
- [x] 2.3 Add unit tests for snapshot sidecar path and freshness validation.
- [x] 2.4 Add projector tests for user/assistant transcript, tool call/result pairing, image tool results, usage stats, and entry ids.

## 3. Cold Subscribe Path

- [x] 3.1 Update `packages/server/src/browser-handlers/subscription-handler.ts` so memory-miss inactive sessions read or build a snapshot instead of calling disk event replay.
- [x] 3.2 Mark `dataUnavailable: true` when snapshot build fails and avoid streaming partial historical replay.
- [x] 3.3 Add handler tests: valid snapshot sends one `session_snapshot`; stale snapshot rebuilds; failed build marks unavailable; warm memory path still uses existing replay.

## 4. Background Prewarm

- [x] 4.1 Add low-concurrency snapshot prewarm queue for missing/stale snapshots.
- [x] 4.2 Enqueue discovered sessions after server startup, sorted newest activity first.
- [x] 4.3 Enqueue snapshot refresh after live `agent_end` for sessions with known `sessionFile`.
- [x] 4.4 Add tests for queue ordering, non-blocking startup hook, and `agent_end` enqueue.

## 5. Verification

- [x] 5.1 Run targeted server/client tests and capture output to `/tmp/cold-snapshot-test.log`.
- [x] 5.2 Run `npm test 2>&1 | tee /tmp/pi-test.log` and grep failures from the log.
- [x] 5.3 Run `openspec validate persist-cold-session-transcripts --strict`.
- [x] 5.4 Manually open a large inactive session after restart and confirm it renders from snapshot without progressive historical streaming.
