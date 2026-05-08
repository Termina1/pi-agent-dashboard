## 1. Shared types

- [x] 1.1 Add optional `pending?: boolean` to `OpenSpecData` in `packages/shared/src/types.ts`
- [x] 1.2 Verify no existing consumer breaks if `pending` is absent (default-falsy semantics)

## 2. Server: fast-detect helper

- [x] 2.1 Export `hasOpenSpecDir(cwd: string): boolean` from `packages/server/src/directory-service.ts` (synchronous `fs.statSync` on `<cwd>/openspec/changes`, returning `false` on any error)
- [x] 2.2 Add unit test for `hasOpenSpecDir` in `packages/server/src/__tests__/has-openspec-dir.test.ts` (true for dir present, false for absent, false for symlink-to-non-dir, false for ENOENT)

## 3. Server: bootstrap broadcasts initial poll completion

- [x] 3.1 In `packages/server/src/session-bootstrap.ts:87`, replace the bare `await directoryService.refreshOpenSpec(cwd)` with the `runPostInstallRepair` pattern from `packages/server/src/server.ts:177`: capture `prior = getOpenSpecData(cwd)` before refresh, compute `priorEmpty || JSON.stringify(prior) !== JSON.stringify(fresh)` after, broadcast `openspec_update` iff true
- [x] 3.2 Pass `browserGateway` into `discoverAndBroadcastSessions` deps if not already present
- [x] 3.3 Update the in-code comment on the bootstrap initial-poll block so it accurately describes the broadcast (replace the aspirational comment that PR #10 left behind)

## 4. Server: on-connect snapshot covers every known cwd

- [x] 4.1 In `packages/server/src/browser-gateway.ts` connect handler (~line 230), drop the `if (data && data.initialized)` filter
- [x] 4.2 For each cwd in `directoryService.knownDirectories()`, build the per-cwd payload using:
  - cached `getOpenSpecData(cwd)` if `initialized: true`
  - `{ initialized: false, pending: true, changes: [] }` if `hasOpenSpecDir(cwd)`
  - `{ initialized: false, pending: false, changes: [] }` otherwise
- [x] 4.3 Send exactly one `openspec_update` per known cwd

## 5. Server: regression tests

- [x] 5.1 Add `packages/server/src/__tests__/cold-boot-openspec-broadcast.test.ts` simulating a client connecting before bootstrap initial poll completes; assert `openspec_update` arrives once polling finishes
- [x] 5.2 Mirror `packages/server/src/__tests__/post-install-openspec-refresh.test.ts:80` — assert no broadcast fires when refreshed data equals prior data (warm-restart idempotency)
- [x] 5.3 Add a test asserting on-connect snapshot emits one message per known cwd, with correct `pending` values (true for cwd with openspec dir but empty cache, false for cwd without openspec dir)

## 6. Client: spinner UX

- [x] 6.1 In `packages/client/src/components/SessionList.tsx:489`, change the gate from `openspecMap?.get(group.cwd)?.initialized` to `(openspecMap?.get(group.cwd)?.initialized || openspecMap?.get(group.cwd)?.pending)` so the section renders for both states
- [x] 6.2 In `packages/client/src/components/FolderOpenSpecSection.tsx`, branch on `data.pending && !data.initialized`: render a small grey spinner where the `OPENSPEC (N CHANGES)` label normally goes; suppress chevron, Refresh, Archive, Specs buttons; section is non-expandable while pending
- [x] 6.3 Use the existing muted text colour token used by the OpenSpec label (read it from current source; no new design tokens)
- [x] 6.4 Verify no layout shift when transitioning from spinner to populated header (same row height, same padding)

## 7. Client: tests

- [x] 7.1 Add `packages/client/src/components/__tests__/FolderOpenSpecSection.pending.test.tsx` — renders spinner for `pending: true`, no spinner for `pending: false`, transitions correctly
- [x] 7.2 Update existing `FolderOpenSpecSection.test.tsx` if any assertion conflicts with the new `pending` rendering branch

## 8. Manual verification

- [x] 8.1 Cold-boot Electron app: open the .desktop launcher, confirm OpenSpec section appears for `pi-agent-dashboard` folder without manual reload, with brief grey spinner during initial poll
- [x] 8.2 Confirm folders without `openspec/changes/` (e.g. `/home/<user>` or non-OpenSpec project) show no spinner and no section
- [x] 8.3 Cold-boot regular browser: confirm no behaviour change (was working, still works)
- [x] 8.4 Manual `Refresh` button still works on populated folders (no regression)

## 9. Docs

- [x] 9.1 Update `docs/file-index-server.md` if `hasOpenSpecDir` warrants a row entry on `directory-service.ts`
- [x] 9.2 Cross-reference this change name from the next-tier follow-up: a sibling fix for `pi-resources` polling, which exhibits the same race pattern (out of scope here, in scope for a follow-up proposal)
