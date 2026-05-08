## 1. Protocol type

- [x] 1.1 Optional `code?: string` on `ResumeResultBrowserMessage` (in place from earlier work)
- [x] 1.2 Optional `code?: string` on `ApiResponse` envelope (in place from earlier work)
- [x] 1.3 Type-check via `tsc --noEmit` clean for our changes

## 2. WS handler — replace refuse with degrade

- [x] 2.1 Remove the existing refuse-with-FORK_EMPTY_SESSION block from `handleResumeSession`
- [x] 2.2 Add the degrade-to-spawn block: when `mode === "fork"` and `!existsSync(sessionFile)`, enqueue parent's `attachedProposal` (if any), call `spawnPiSession(cwd, { strategy })` with NO sessionFile/mode, register pid+token, record correlation, send `resume_result { success, code: "FORK_DEGRADED_TO_NEW", message, requestId }`
- [x] 2.3 Drop the `FORK_EMPTY_SESSION_*` constants (no longer used). Add `FORK_DEGRADED_TO_NEW_MESSAGE` and `FORK_DEGRADED_TO_NEW_CODE` for shared use with REST handler.

## 3. REST handler — same change

- [x] 3.1 Remove the refuse-with-409 block from `/api/session/:id/resume`
- [x] 3.2 Add the same degrade-to-spawn flow; on success, return HTTP 200 with `{ success: true, data: { message }, code: "FORK_DEGRADED_TO_NEW" }`
- [x] 3.3 Reuse the imported constants from `session-action-handler.js`

## 4. Tests — rewrite for new behavior

- [x] 4.1 Replace refuse-on-missing-file test with degrade-on-missing-file test
- [x] 4.2 Assert `spawnPiSession` IS called for fork-empty (with no sessionFile, no mode field)
- [x] 4.3 Assert `pendingAttachRegistry.enqueue` is called when parent has `attachedProposal`
- [x] 4.4 Assert `resume_result` carries `code: "FORK_DEGRADED_TO_NEW"` on success
- [x] 4.5 Assert continue-mode is unaffected by the new path
- [x] 4.6 Assert spawn failure on degraded path does NOT set `code: "FORK_DEGRADED_TO_NEW"`

## 5. Client — toast on degradation

- [x] 5.1 In `useMessageHandler.ts` `case "resume_result"` SUCCESS branch, when `msg.code === "FORK_DEGRADED_TO_NEW"`, surface the message as a non-blocking notification via `setSpawnResult` (reuses existing toast slot)
- [~] 5.2 Improved toast styling / inline note on the new session card — _deferred follow-up; current path uses the existing spawnResult toast_

## 6. Documentation

- [x] 6.1 CHANGELOG.md `[Unreleased]` `### Fixed` entry rewritten to describe the silent-degrade behavior (replacing the prior FORK_EMPTY_SESSION-refuse description)
- [x] 6.2 No file-index updates needed

## 7. Verification

- [x] 7.1 `npm test` — all suites green except 3 pre-existing jiti failures
- [~] 7.2 Manual: spawn a fresh session, immediately click Fork → fresh session appears in same cwd within ~1s with a toast about the degradation — _operator gate_
- [~] 7.3 Manual: parent has `attachedProposal` → forked-degraded session inherits it — _operator gate_
- [~] 7.4 Manual: fork session with real history → unchanged behavior — _operator gate_
