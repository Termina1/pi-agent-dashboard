# Code Context — Plannotator dashboard fixes

## Current behavior

- Plannotator review UI uses dashboard proxy route `/plannotator/*` to reach local Plannotator server on `127.0.0.1:19432`.
- `plannotator_submit_plan` running tool card remains visible across dashboard server restart / bridge reattach while the tool has no persisted `toolResult` yet.
- Plannotator `ctx.ui.notify(...)` review-link messages are suppressed in dashboard; submit-plan tool card is the single review entry point.
- Token/cache/cost stats aggregate per user prompt instead of creating one bar per internal LLM call.

## Key files

1. `packages/shared/src/state-replay.ts`
   - `replayEntriesAsEvents(sessionId, entries, options)` accepts `ReplayEntriesOptions`.
   - `closeOpenToolCalls: false` keeps open tool calls running during live bridge reattach.
   - Default behavior still closes orphaned tool calls for cold ended-session replay.

2. `packages/extension/src/session-sync.ts`
   - Bridge replay calls `replayEntriesAsEvents(..., { closeOpenToolCalls: false })`.
   - Prevents synthetic `tool_execution_end` from hiding active Plannotator submit card after dashboard restart.

3. `packages/extension/src/bridge.ts`
   - Keeps `PLANNOTATOR_REMOTE=1` and `PLANNOTATOR_BROWSER=none` for browser-visible review URLs.
   - `ctx.ui.notify` wrapper drops Plannotator notify messages (`plannotator`, `:19432`, `/plannotator`).

4. `packages/client/src/lib/event-reducer.ts`
   - `addInteractiveRequest` drops Plannotator notify requests as a client-side fallback.
   - `stats_update` merges multiple LLM usage blocks into one `turnStats` entry for the last user message.

5. `packages/client/src/components/interactive-renderers/NotifyRenderer.tsx`
   - Direct Plannotator notify rendering returns `null`.
   - Non-Plannotator notify messages still render normally with link rewriting.

6. `packages/client/src/components/tool-renderers/PlannotatorSubmitPlanRenderer.tsx`
   - Running `plannotator_submit_plan` card remains the review UI surface: “Waiting for Plannotator review” + “Open Plannotator review”.

## Verification

- Targeted tests: `144 passed`.
- Full suite: `5421 passed | 16 skipped`.
- Typecheck/lint: `npm run lint` passed.
- Build: `npm run build` passed.
- Dashboard restart: `POST /api/restart` returned `{ "ok": true }`.
- Session reload: `npm run reload` sent reload to 8 sessions.
