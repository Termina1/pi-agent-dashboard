## Why

Forking a session that has no `.jsonl` file on disk yet (e.g., a freshly-spawned session before any message has been sent) produces a confusing **30-second silent timeout** with no actionable feedback. The chain:

1. Pi only writes a session's JSONL on the first persisted entry — empty sessions exist in metadata but have no on-disk file.
2. `pi --fork <path>` requires `<path>` to exist. Pi has no graceful fallback for missing files.
3. The dashboard stores `session.sessionFile` from the bridge's `session_register` — that path is pi's *intended* file location, not a guarantee that it exists.
4. `handleResumeSession` (and the `/api/session/:id/resume` REST handler) calls `spawnPiSession` with the missing path → spawned pi crashes immediately.
5. The headless wrapper `sh -c "tail -f /dev/null | pi …"` keeps the parent `sh` alive even after pi dies, so `spawnDetached`'s 300ms crash window sees the wrapper still running and reports `success: true`.
6. The bridge inside the dead pi never registers, so `spawn-register-watchdog` ticks for 30 seconds and finally emits `spawn_register_timeout`.
7. User experience: the placeholder card sits there for 30s, then a generic "Pi started but never connected" banner appears.

**The user-meaningful semantic of "fork an empty session" is identical to "spawn a new session in the same cwd"**: an empty source has no history to copy, so the only behavioral difference is dashboard-side bookkeeping (place-after-parent ordering, attachedProposal inheritance). Refusing the operation is technically honest but makes the user resolve a constraint they don't care about. Better UX: silently degrade to a fresh spawn, inherit what's worth inheriting (attachedProposal), and tell the user what we did via a non-blocking toast.

## What Changes

- **NEW** behavior in `handleResumeSession` (WS handler) and `POST /api/session/:id/resume` (REST handler): when `mode === "fork"` and `existsSync(session.sessionFile)` returns false, the server SHALL silently degrade to a fresh spawn in the same cwd. The fresh spawn SHALL inherit the parent's `attachedProposal` (when present) via `pendingAttachRegistry`. The response SHALL carry `code: "FORK_DEGRADED_TO_NEW"` and a human message explaining the degradation.
- **NEW** structured code on `resume_result` and the REST response: `code: "FORK_DEGRADED_TO_NEW"`. Clients MAY render a non-blocking toast on the new session card. Old clients see only the message.
- **NEW** optional `code?: string` field on `ApiResponse` envelope so REST endpoints can emit the same structured codes the WS protocol uses.
- **MODIFIED** `session-resume` capability: fork preflight requirement spelled out as silent degradation (not refusal).
- **MODIFIED** `resume_result` browser message: optional `code?: string` field added (already added by `spawn-correlation-token` in this branch — confirmed).
- No bridge changes. No protocol breaking change. No 30-second timeouts on this path.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `session-resume`: add a preflight requirement covering the `existsSync` check and the silent-degradation behavior with the FORK_DEGRADED_TO_NEW code path.

## Impact

**Code**:
- `packages/server/src/browser-handlers/session-action-handler.ts` — `handleResumeSession`, fork branch: replace refuse with degrade-to-spawn flow
- `packages/server/src/session-api.ts` — `/api/session/:id/resume` REST handler, fork branch: same change
- `packages/shared/src/browser-protocol.ts` — `code?: string` on `ResumeResultBrowserMessage` (already in place)
- `packages/shared/src/types.ts` — `code?: string` on `ApiResponse` (already in place)
- `packages/client/src/hooks/useMessageHandler.ts` — render the degradation note as a non-blocking notification on the new session card

**Tests**:
- Replace refuse-on-missing-file tests with degrade-to-spawn tests
- Assert `spawnPiSession` IS called for fork-empty (without sessionFile, without mode)
- Assert response carries `code: "FORK_DEGRADED_TO_NEW"` and `success: true` when the fresh spawn succeeds
- Assert parent's `attachedProposal` is enqueued for the new session

**Compatibility**:
- Backwards-compatible. New code field is optional. Old clients ignore it and see a generic success.
- Old behavior (refusing with FORK_EMPTY_SESSION) is replaced — but it was just-shipped; no production users expect it.
- No env vars, no new dependencies.

**UX outcomes**:
- Click Fork on empty session → working session in same cwd within ~1s instead of 30-second silent timeout.
- User learns what happened via a small toast on the new card.
- attachedProposal carries over, so an attached change still gets applied to the new session.
- No more REGISTER_TIMEOUT entries in `~/.pi/dashboard/sessions/spawn-failures.log` for this case.

**Out of scope**:
- Fixing `pi --fork <missing>` to degrade upstream — pi-side change.
- Detecting "wrapper alive but pi dead" in `spawnDetached`'s crash window — separate proposal.
- Disabling the Fork button for empty sessions in the UI — possible follow-up; would need to thread the message-count signal into the session shape. The toast is sufficient for the first cut.

## Relation to other changes

Independent of `spawn-correlation-token`. Both can land in either order. This proposal addresses a UX/correctness issue that pre-dates `spawn-correlation-token` — the silent-timeout failure mode is visible in `spawn-failures.log` entries from May 5, before any of our work. Together they make the fork path race-free AND fail-graceful.

## Design history

This proposal originally specified "refuse with FORK_EMPTY_SESSION error" — the strict-honesty path. Reviewer feedback rightly observed that "fork an empty session" is semantically equivalent to "spawn a new session" from the user's perspective, and that the refuse path makes the user solve a constraint they didn't care about. The proposal now specifies silent-degrade-with-toast, which respects user intent and surfaces the edge case via lightweight feedback.
