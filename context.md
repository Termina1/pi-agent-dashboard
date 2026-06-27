# Code Context

## Files Retrieved
1. `docs/file-index.md` (lines 1-25) - split map; confirms relevant split files are client, server, extension, shared.
2. `docs/file-index-client.md` (lines 104-114, 139-147) - rows for app submit state, chat/input rendering, markdown/link/image asset rendering.
3. `docs/file-index-server.md` (lines 14-20) - rows for server route registration, file routes, and existing normal asset route pattern.
4. `docs/file-index-extension.md` (lines 27-31) - rows for PromptBus/dashboard prompts and extension asset/tool emission.
5. `docs/file-index-shared.md` (lines 11-13) - rows for Extension↔Server and Server↔Browser message unions plus Session asset model.

## Key Code
Relevant index rows only; no source files read.

- `src/client/App.tsx` — owns per-session draft/images state and `wrappedHandleSend`; clears draft/images after send. Relevant to “snippet should always appear on submit” because submit path starts here and state is keyed by session.
- `src/client/components/CommandInput.tsx` — chat textarea submit/autocomplete area; controlled `draft`, `images`, `onImagesChange`; image attachment flows through `useImagePaste.addFiles`. Relevant to user submit behavior and whether snippet metadata is included/displayed.
- `src/client/components/ChatView.tsx` — chat message view; renders user messages and controls bottom scrolling. Relevant to bottom-of-chat confusing message/report display.
- `packages/client/src/components/MarkdownContent.tsx` — shared markdown renderer; external link handling and `pi-asset:<hash>` → HTTP asset route. Relevant to snippet links currently using unsupported `https`/port and desired normal route behavior.
- `packages/client/src/lib/SessionAssetsContext.tsx` — `assetUrl(hash) = /api/assets/${hash}`. Relevant as existing client-side route-based asset pattern.
- `packages/client/src/components/tool-renderers/ShowImageToolRenderer.tsx` — uses `assetUrl(hash)` and `<img src="/api/assets/<hash>">`. Relevant as existing renderer example that avoids direct port URLs.
- `src/server/server.ts` — registers asset routes. Relevant if new proxy/normal route must be registered at server composition point.
- `src/server/routes/file-routes.ts` — REST file/read/browse routes. Relevant possible home for file/snippet read route if snippet is file-like rather than asset-like.
- `packages/server/src/routes/asset-routes.ts` — `GET /api/assets/:hash`, networkGuard-gated, extensionless URL. Relevant route/proxy model to mirror for snippets instead of exposing `https` plus port.
- `packages/server/src/asset-store.ts` — disk-backed content-addressed asset store. Relevant if snippets become stored/served artifacts.
- `src/extension/prompt-bus.ts` and `src/extension/dashboard-default-adapter.ts` — dashboard prompt routing. Relevant to “blue message at bottom” if it is an interactive prompt/request artifact.
- `packages/extension/src/show-image-tool.ts` — emits `asset_register` and returns tool details with hash. Relevant as extension-to-dashboard asset registration pattern.
- `src/shared/protocol.ts` — Extension↔Server message unions. Relevant if planonator/snippet messages originate from bridge extension.
- `src/shared/browser-protocol.ts` — Server↔Browser unions, including `BrowserAssetRegisterMessage.data` optional and PromptBus messages. Relevant if snippet route/message requires protocol updates.
- `src/shared/types.ts` — `Session.assets` data optional, server stores bytes and browser fetches via `/api/assets/:hash`. Relevant existing session asset contract.

## Architecture
- Extension emits events/messages over Extension↔Server protocol (`src/shared/protocol.ts`) to server.
- Server composes REST + WebSocket routes in `src/server/server.ts`; browser protocol lives in `src/shared/browser-protocol.ts`.
- Browser state and submit flow are centered in `src/client/App.tsx` and `src/client/components/CommandInput.tsx`; rendered transcript lives in `src/client/components/ChatView.tsx`.
- Existing safe asset pattern: extension/tool produces asset hash → server persists bytes (`packages/server/src/asset-store.ts`) → server exposes normal auth/network-guarded route (`packages/server/src/routes/asset-routes.ts`) → client renders `/api/assets/<hash>` via `SessionAssetsContext.assetUrl` and `MarkdownContent`/`ShowImageToolRenderer`.
- User’s requested “normal route not a port” likely maps to this existing `/api/...` pattern, but docs index contains no direct `planonator`/`планнонатор` row.

## Start Here
Open `src/client/components/CommandInput.tsx` first: it owns submit UI behavior and is the closest indexed entry for “snippet should always appear on submit.” Then follow into `src/client/App.tsx` for send handling and into route/asset files if link generation needs server support.

## Relevant Rows + Why
1. `src/client/components/CommandInput.tsx` — submit/input component; likely first touch point for ensuring snippet always appears on submit.
2. `src/client/App.tsx` — wraps send handler and owns per-session input state; may clear or preserve snippet-related state after send.
3. `src/client/components/ChatView.tsx` — bottom chat rendering/scroll area; relevant to confusing blue message placement.
4. `packages/client/src/components/MarkdownContent.tsx` — link rendering and `pi-asset:` handling; relevant to unsupported snippet links.
5. `packages/client/src/lib/SessionAssetsContext.tsx` — route-based asset URL helper; relevant model for `/api/...` snippet links.
6. `packages/server/src/routes/asset-routes.ts` — normal server route pattern for browser-fetchable artifacts; likely route model to reuse.
7. `src/server/server.ts` — route registration point.
8. `src/shared/browser-protocol.ts` / `src/shared/protocol.ts` / `src/shared/types.ts` — protocol/type contracts if snippet metadata crosses extension/server/browser boundary.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Scoped to docs/file-index.md plus relevant docs/file-index-*.md rows only; no source files read; wrote requested context artifact."
    }
  ],
  "changedFiles": [
    "context.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "read docs/file-index.md",
      "result": "passed",
      "summary": "Identified index split files."
    },
    {
      "command": "grep docs/file-index-*.md for planonator/snippet/submit/proxy/link terms",
      "result": "passed",
      "summary": "No planonator-specific row found; found relevant client/server/extension/shared rows."
    },
    {
      "command": "read selected docs/file-index-client.md, server, extension, shared line ranges",
      "result": "passed",
      "summary": "Retrieved only relevant index rows."
    },
    {
      "command": "git status --short",
      "result": "passed",
      "summary": "No staged files; existing unstaged modifications in unrelated files plus context.md untracked/updated."
    }
  ],
  "validationOutput": [
    "No source files read.",
    "No docs row matched planonator/планнонатор directly."
  ],
  "residualRisks": [
    "Index may omit planonator-specific files; task forbade source reads and speculation."
  ],
  "noStagedFiles": true,
  "diffSummary": "Wrote investigation context to context.md only.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "git status also showed pre-existing unstaged changes in packages/client/src/components/FolderActionBar.tsx and packages/client/src/components/__tests__/SessionList.test.tsx."
}
```
