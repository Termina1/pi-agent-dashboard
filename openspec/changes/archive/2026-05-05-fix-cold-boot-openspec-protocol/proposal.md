## Why

When the Electron app spawns the dashboard server and immediately loads
`http://localhost:8000`, the BrowserWindow's WebSocket connects before
the server's initial `openspec` polling completes. The on-connect
snapshot loop only emits `openspec_update` for cwds whose cache is
already `initialized: true`, so the cold-boot client receives nothing
for known directories that are still polling. The bootstrap path
(`session-bootstrap.ts:87`) was switched from synchronous `await` to
fire-and-forget `void Promise.all` in PR #10 (`422bf5d`,
"Windows integration v3") to keep startup fast, but the broadcast that
the in-code comment promises ("openspec data populates in the
background and pushes `openspec_update` broadcasts to browsers as each
directory finishes") was never wired up. The scheduled poll tick that
runs 30 s later compares the populated cache against itself, sees no
diff, and stays silent. Net result: Electron stays empty until the
user reloads, while regular browsers (which always connect later, when
the cache is hot) escape the race entirely.

The existing `server-openspec-polling` spec already mandates
*"the server SHALL poll openspec for each known directory and
broadcast initial results to any connected browsers"* on startup — the
implementation regressed.

A second, related gap blocks any visible loading feedback: the protocol
omits messages for cwds without `openspec/changes/`, so the absence of
an `openspec_update` is overloaded ("no openspec here" vs "still
loading" vs "race lost"). A loading spinner cannot tell the difference.

## What Changes

- **Bootstrap broadcasts after each initial poll** — `session-bootstrap.ts`
  mirrors the `runPostInstallRepair` pattern (`server.ts:177`): for
  every cwd, `priorEmpty || dataDiffers` triggers
  `browserGateway.broadcastToAll({ type: "openspec_update", cwd, data })`.
- **Fast-detect helper** — `directory-service.ts` exposes
  `hasOpenSpecDir(cwd): boolean` (synchronous `fs.statSync` on
  `<cwd>/openspec/changes`). Microsecond cost, no spawn.
- **`pending` field added to `OpenSpecData`** — when an `openspec/changes/`
  directory exists but the slow poll hasn't completed yet, the server
  emits `{ initialized: false, pending: true, changes: [] }`. When the
  directory does not exist, the server emits
  `{ initialized: false, pending: false, changes: [] }`.
- **On-connect snapshot covers every known cwd** — `browser-gateway.ts`
  drops the `if (data && data.initialized)` filter; instead it always
  emits one `openspec_update` per known cwd, using `hasOpenSpecDir`
  + cache state to fill `pending` correctly.
- **Spinner UX in `FolderOpenSpecSection`** — when an incoming message
  has `pending: true`, render a small grey spinner where the
  `OPENSPEC (N CHANGES)` label normally appears. No spinner, no section,
  no flash for cwds with `pending: false` and `initialized: false`.
- **Regression test** — new server-side test simulates a cold-boot
  client connecting before initial polling completes and asserts an
  `openspec_update` arrives once polling finishes.

## Capabilities

### New Capabilities
*(none)*

### Modified Capabilities
- `server-openspec-polling`: add `pending` field to broadcast payload;
  enforce on-connect broadcast for every known cwd; require bootstrap
  initial poll to broadcast on completion.
- `openspec-folder-section`: render grey spinner when `pending: true`;
  unchanged for `initialized: true` and for `initialized: false` with
  `pending: false`.

## Impact

- **Affected files**:
  - `packages/server/src/session-bootstrap.ts` (broadcast on initial poll)
  - `packages/server/src/directory-service.ts` (export `hasOpenSpecDir`)
  - `packages/server/src/browser-gateway.ts` (always-broadcast on-connect snapshot)
  - `packages/shared/src/types.ts` (`OpenSpecData.pending?: boolean`)
  - `packages/shared/src/openspec-poller.ts` (`buildOpenSpecData` honors `pending`)
  - `packages/client/src/components/FolderOpenSpecSection.tsx` (spinner)
- **Wire bandwidth**: one extra `openspec_update` per non-OpenSpec cwd per
  client connect. Negligible (~50 bytes × N cwds, once).
- **No protocol breakage**: `pending` is an optional boolean; older
  clients ignore it. Older servers omit it; newer clients treat absence
  as `pending: false`.
- **No behavior change for warm clients**: clients that connect after
  the server's cache is hot follow the existing path verbatim.
