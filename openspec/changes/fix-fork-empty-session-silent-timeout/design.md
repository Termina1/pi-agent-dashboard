## Context

The dashboard's "Fork session" UX promises a quick branch from an existing conversation. For sessions with persisted history this works correctly. For sessions that exist in dashboard metadata but have no `.jsonl` on disk (empty sessions — spawned then forked without any message), the fork operation fails opaquely with a 30-second silent timeout (full chain documented in proposal.md).

The detection signal exists at request time: `existsSync(sessionFile)` returns false. The original draft of this proposal handled it with a strict refuse-and-error response. Reviewer feedback observed that **the user-meaningful semantic of "fork empty" and "spawn new" is identical** — the only behavioral differences are dashboard bookkeeping (place-after-parent in the cwd order, attachedProposal inheritance), neither of which is more useful when failed than when silently substituted. This document captures the redesign: silent degradation with an informational code.

## Goals / Non-Goals

**Goals:**

- Replace the 30-second silent-timeout failure with an immediate working session.
- Preserve user intent: clicking Fork should produce a session ready to use in the same cwd.
- Inherit the parent's `attachedProposal` so an attached change is not silently dropped.
- Communicate the degradation honestly to the client via a structured `code: "FORK_DEGRADED_TO_NEW"`.
- Cover both the WS handler (`handleResumeSession`) and the REST handler (`/api/session/:id/resume`) — same logic, same response shape.
- Keep the change tightly scoped: no protocol breaking changes, no bridge changes, reuse existing spawn primitives.

**Non-Goals:**

- Fixing pi's `--fork` to handle missing files. That's a pi-project decision and outside the dashboard's reach.
- Detecting "wrapper alive but pi dead" inside `spawnDetached`'s crash window. That's a broader concern (other crash patterns share it) — separate proposal worth doing but not bundled here.
- Auto-creating an empty `.jsonl` for the source session to make pi `--fork` work. Would create a dashboard-side artifact pi never writes; risky and pointless.
- Disabling the Fork button on empty sessions in the UI. Possible follow-up; today the Fork button is shown for any ended session and we'd need to thread the message-count signal through the session shape. The degradation path is sufficient for the first cut.
- Implementing place-after-parent ordering for the degraded session. The fork-specific bookkeeping in `pendingForkRegistry` is bypassed because (a) there's no parent history to fork from, so "after parent" isn't a meaningful semantic; (b) avoiding the registry simplifies the rollback story if the spawn fails.

## Decisions

### Decision 1: Silent degradation, not refusal

**Choice**: When the source session has no on-disk `.jsonl`, perform a fresh spawn in the same cwd. Do NOT refuse the operation.

**Rationale**: Three converging arguments:

1. **User intent**: The user clicked Fork because they wanted a session in this folder, possibly inheriting some context. An empty source has no context to inherit, but the cwd alignment is real and respecting that intent is the simplest "do the right thing" move.
2. **Behavioral equivalence**: For empty sources, "fork" and "spawn-new" produce sessions that are operationally identical from pi's perspective. The dashboard-side differences (place-after-parent, attachedProposal inheritance) are minor — and one of them (attachedProposal) is preserved by this design.
3. **Constraint hiding**: The "fork needs a JSONL" rule is a pi limitation, not a user-meaningful semantic. Forcing the user to learn it (refuse path) costs more than just respecting the click.

**Alternative rejected**: Refuse with `FORK_EMPTY_SESSION` code (the original proposal). Honest, but pedantic. Each user encounter requires them to interpret an error message and take a workaround they shouldn't have to.

### Decision 2: New structured code `FORK_DEGRADED_TO_NEW`

**Choice**: When the degradation fires successfully, the server SHALL include `code: "FORK_DEGRADED_TO_NEW"` on the `resume_result` (and the REST envelope's `code` field). The client SHOULD render a non-blocking notification (toast or inline note) explaining the substitution.

**Rationale**: Silent without any signal would let the user wonder later why their "fork" doesn't share state with the parent — they wouldn't realize the parent had no state to share. A small note communicates the edge case without blocking. The structured code is cheap and decouples server-message text from client-presentation text.

**Alternative rejected**: Pure silent degradation, no code, no message. Cleanest but loses the teaching moment.

**Alternative rejected**: Inline message text only (no `code`). Works for the toast but loses structure for later automation (e.g., a tutorial that wants to detect this case).

### Decision 3: Inherit `attachedProposal` via `pendingAttachRegistry`

**Choice**: If the parent session has an `attachedProposal`, the degradation path enqueues it in `pendingAttachRegistry` keyed by the parent's `cwd` BEFORE invoking `spawnPiSession`. When the new pi process registers, the existing pending-attach pipeline applies the proposal to the new session.

**Rationale**: This is the closest analogue to fork's bookkeeping that survives empty sessions. Fork's `pendingForkRegistry.recordFork(token, parentSessionId)` would otherwise inherit `attachedProposal` from parent at register time; degrading to spawn loses that linkage. Re-inheriting via `pendingAttachRegistry` (the same primitive used by the spawn-with-attach feature) preserves the semantic without coupling to fork-specific code paths.

**Alternative rejected**: Skip the inheritance entirely. Cleaner code but loses a useful behavior — if the user attached a change to the parent before forking, they expect the fork to carry it.

**Alternative rejected**: Use `pendingForkRegistry` and `recordFork` to get the same inheritance plus place-after-parent ordering. Couples the degraded path to fork-specific machinery; the place-after-parent semantic is debatable for a session that never had history. Inherit-only via attach-registry is simpler.

### Decision 4: Don't use `pendingForkRegistry` for the degraded session

**Choice**: The degraded spawn does NOT call `pendingForkRegistry.recordFork`. Place-after-parent ordering does not apply.

**Rationale**: `pendingForkRegistry`'s job is to place a forked session adjacent to its parent in the cwd's order array. For a session that never had history, "adjacent to parent" is a fragile semantic — the user's mental model is "I clicked Fork on session X, give me a session here." Default ordering (front of cwd, like a fresh spawn) is fine; the user can manually reorder if they care.

**Alternative rejected**: Record the fork relationship to preserve ordering. Adds complexity and doesn't materially improve the UX.

### Decision 5: Synchronous existsSync check in the server

**Choice**: The dashboard server checks `existsSync(session.sessionFile)` immediately before deciding fork-vs-degrade.

**Rationale**: The bridge runs inside pi processes and only knows about its OWN session. The dashboard server already has `session.sessionFile` cached and is the only component that knows about all sessions. Adding the check at the server is a single-place fix.

**Alternative rejected**: Adding the check inside `spawnPiSession`. Pushes mode-specific logic into a generic spawn primitive. Better to keep `spawnPiSession` mode-agnostic.

### Decision 6: Don't touch the WS protocol shape beyond the `code` field

**Choice**: Existing message types stay. The `code` field on `ResumeResultBrowserMessage` and `ApiResponse` is sufficient.

**Rationale**: We already added the optional `code` to both shapes (when this proposal was originally about FORK_EMPTY_SESSION refusal). The new code value `FORK_DEGRADED_TO_NEW` slots in unchanged.

## Risks / Trade-offs

[Risk] **`existsSync` race**: between the check and the spawn, the file could be created/deleted by another process. → **Mitigation**: the race window is microseconds; the only realistic timeline where the file appears mid-check is "user sent a message in another tab while we were processing fork" — which would still produce a working session via the degraded path (just less optimally). Acceptable.

[Risk] **Path normalization mismatch**: `session.sessionFile` might use one path style (e.g., trailing slash, symlink) and `existsSync` interprets differently. → **Mitigation**: `existsSync` follows symlinks and tolerates trailing slash. SessionFile paths from pi are absolute. No reported issues with this pattern in similar checks elsewhere in the codebase.

[Risk] **User confusion on later "why don't my forks share state with parent?"** → **Mitigation**: the toast surfaces the substitution. Users who care will see the note; users who don't will get a working session.

[Risk] **`attachedProposal` inheritance creates an unexpected attach** → **Mitigation**: this matches what regular fork would do; consistent semantic. If user wants to detach, they can via the existing detach UI.

[Trade-off] **Two near-identical code blocks** (WS handler + REST handler). Could be extracted to a helper — but the duplication is ~20 lines each, and the contexts differ slightly (WS uses `sendTo` + send result shape; REST uses Fastify reply with HTTP code). Inline duplication is clearer than premature abstraction; if a third caller appears, extract then.

[Trade-off] **Ordering semantics**: degraded session does not inherit place-after-parent ordering. Some users may wonder why a "fork" landed at the front. The toast can include "(this fork was started fresh because the source had no history)" to explain.

## Migration Plan

Single PR. No persistent state change. No deployment ordering.

**Rollback**: revert the PR. Old behavior (30-second silent timeout) returns. No data loss.

**From the original refuse-shipped state**: the just-shipped refuse-with-FORK_EMPTY_SESSION code is replaced by this design. Tests are rewritten to assert degrade-and-succeed instead of refuse-and-error. CHANGELOG entry is updated.

## Open Questions

None. The design is small and localized.
