## Why

When a user types `/skill:openspec-explore continue with X` in the dashboard chat input, the dashboard's bridge expander reads `SKILL.md` from disk, strips the YAML frontmatter, and **inlines the entire skill body** into the user message before sending it to pi. The persisted user message is therefore a 200–8000 character wall of skill body text plus the user's actual instruction at the end. Three concrete user-pains follow:

1. **Chat noise.** The user bubble in chat shows the whole skill body. The user's actual message ("continue with X") is buried in the last paragraph. This breaks scan-readability of the conversation.

2. **Up-arrow recall is unusable.** `CommandInput`'s `ArrowUp` history-recall pulls the previous user message verbatim. After a skill turn the user has thousands of characters of skill body in their input box; they'd need to delete it and re-type `/skill:foo` to invoke the skill again.

3. **Session names and search use the same content.** `firstMessage` (first 200 chars of the first user message) drives `getSessionDisplayName` and `filterByQuery`. A session spawned with `/skill:openspec-explore` ends up named "Enter explore mode. Think deeply…" instead of something the user can recognise.

There is a second, related fact discovered during exploration: **pi's own `_expandSkillCommand` already wraps its output in `<skill name="..." location="..."> body </skill>\n\nargs`** — a stable, parseable format with a public `parseSkillBlock` parser. The dashboard's separate expander (`packages/extension/src/prompt-expander.ts`) emits the body **without** that wrapper, making dashboard-typed skill turns structurally unrecoverable. Aligning the two ingress paths to a single format is a five-line patch and unlocks recovery in every consumer.

## What Changes

- **MODIFY**: `packages/extension/src/prompt-expander.ts` so that when the resolved template is a skill (either via the local `skill:<name>` map key or pi's `getCommands()` fallback with `source==="skill"`), the expander wraps the body using the exact byte-for-byte format pi emits: `<skill name="${name}" location="${filePath}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>${args ? "\n\n" + args : ""}`. Plain prompt templates (non-skill) continue to emit the un-wrapped body; templates are out of scope for this change.

- **NEW**: `packages/shared/src/skill-block-parser.ts` exporting a single pure function `parseSkillBlock(text)` that returns `{ name, location, body, args, condensed } | null` where `condensed = "/skill:" + name + (args ? " " + args : "")`. The regex matches `^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$` (anchored, non-greedy body, optional trailing args). Used by every consumer below.

- **MODIFY**: `packages/server/src/session-scanner.ts` and `packages/server/src/session-discovery.ts` so that when extracting the 200-char `firstMessage`, the scanner runs `parseSkillBlock` on the full user message **before** truncating; if matched, `firstMessage` is set to `block.condensed.slice(0, 200)`. This is required because the wrapper alone is ~264 characters for typical absolute paths, so a naïve 200-char slice cuts off mid-attribute and the client cannot recover.

- **MODIFY**: `packages/client/src/lib/event-reducer.ts` `message_start` handler for `role === "user"` so that after extracting the `text` content it runs `parseSkillBlock(text)` and, on match, stamps a new optional field `skill: { name, location, body, args }` on the `ChatMessage`. The raw `content` string is preserved unchanged (so existing copy-as-markdown semantics are preserved and rehypeRaw still renders the body invisibly under today's chat).

- **MODIFY**: `packages/client/src/lib/message-history.ts` `extractUserPromptHistory` so that for each user message, if `parseSkillBlock(content)` matches the function pushes `block.condensed` into the history list instead of `content`. Plain user messages continue to push `content` verbatim. This is the keystone of the up-arrow fix.

- **MODIFY**: `packages/client/src/components/ChatView.tsx` user-bubble branch so that when `msg.skill` is present, the renderer emits a new `<SkillInvocationCard>` component instead of `<MessageBubble>`. The card visually distinguishes itself from regular user bubbles with a different border tint and a wrench icon, displays the full slash-command form (`/skill:openspec-explore continue with X`) prominently, and starts collapsed.

- **NEW**: `packages/client/src/components/SkillInvocationCard.tsx`. Card composition:
  - Header (always visible): wrench icon + monospace `/skill:${name}${args ? " " + args : ""}` (full, never truncated; wraps if long) + chevron toggle (▸ collapsed / ▾ expanded).
  - Body (visible only when expanded): `<MarkdownContent content={skill.body} />`. When args are present, they render below the body separated by a horizontal rule.
  - Footer (always visible, identical to existing `MessageBubble`): timestamp + three copy buttons:
    - **Copy as Markdown** — copies the raw stored `content` (the full `<skill>...</skill>` wrapper plus args). Preserves existing semantic of "copy what was sent."
    - **Copy as plain text** — copies the rendered DOM `innerText` (body + args without wrapper). Preserves existing semantic.
    - **Copy as command** — NEW: copies `block.condensed` (e.g. `/skill:openspec-explore continue with X`).
  - Fork-from-message button stays in the same position.
  - Default collapsed; per-message expansion state is local component state (not persisted).

- **NO CHANGE**: `packages/client/src/lib/session-display-name.ts`, `packages/client/src/lib/session-grouping.ts`. They consume `firstMessage` which now arrives pre-condensed from the server. Search "explore" still hits "/skill:openspec-explore continue with X" because the skill name and the args are both in the condensed string.

- **NO CHANGE**: Schema, protocol, persistence, migrations. The `<skill>` wrapper has been part of pi's own output format since pi shipped skills; we are aligning to it, not inventing new shape. Pre-fix dashboard sessions remain readable (they render unchanged); pre-fix pi-TUI multi-line invocations (`/skill:foo\nargs`, which pi today fails to expand) also continue to work — they pass through as raw slash form, which is already the desired condensed form.

## Capabilities

### New Capabilities

- `skill-invocation-rendering`: defines the `<skill>` wrapper format, the `parseSkillBlock` contract, the `SkillInvocationCard` component, the up-arrow recall behavior over skill messages, and the server-side `firstMessage` condensation rule.

### Modified Capabilities

- `chat-input-state`: the up-arrow recall list now contains condensed slash forms for skill messages instead of raw expanded bodies.
- `chat-view`: user messages with `msg.skill` set render via `SkillInvocationCard` instead of `MessageBubble`.

## Impact

**User-visible:**
- Chat shows clean skill cards instead of walls of skill-body text.
- ↑ in the input box recalls `/skill:foo args`, never the expanded body.
- Sidebar session names show recognisable slash forms for skill-spawned sessions.
- Search still works against args and skill names; existing search habits unchanged.

**Implementation:**
- Files touched: 9 (3 new + 6 modified).
- LOC added: ~150. LOC removed: ~5.
- New tests: ~15 across shared, extension, server, client.
- Schema changes: 0. Protocol changes: 0. Migration: 0.
- Backward compat: pre-fix sessions render and behave identically to today.

**Out of scope (deferred to future work):**
- Prompt templates (`.pi/prompts/*.md` non-skill). Same machinery would extend, but tag choice (`<prompt-template>` vs other) deserves its own decision; current pain is overwhelmingly skill-driven.
- Server-side indexing or search by skill name across sessions.
- Per-user "expanded by default" preference; defaulting collapsed is sufficient.
- Migrating older sessions' `firstMessage` retroactively. The server-side condensation kicks in next time the scanner reads a session file.

## Cross-references

- **Adjacent**: `fix-extension-slash-commands-in-dashboard` modifies the same `bridge.ts::sessionPrompt` callback to route slash commands through `pi.session.prompt` (so pi's extension-command dispatcher runs). It changes the **call site around** `expandPromptTemplateFromDisk`; this proposal changes what `expandPromptTemplateFromDisk` **returns**. Independent and composable in either order.
- **Mechanical conflict**: `add-dashboard-slash-commands` (0/69 tasks done) refactors `readTemplate()` to return `{frontmatter, body}` and introduces `loadPromptTemplate()` returning a discriminated `{kind: "llm" | "exec"}` union. If that proposal ships AFTER this one, its `kind: "llm"` branch must preserve the `<skill>` wrapping introduced here (~5 LOC). If it ships BEFORE this one, this proposal's wrap call moves inside its `kind: "llm"` branch (~3 LOC). Either order is a small mechanical rebase; semantic intent is compatible.

## Decisions Captured (from explore session)

1. **Wrap in bridge — yes.** The dashboard's expander now emits the same `<skill>` wrapper pi emits. Single fix point, single format, retroactive recoverability for all future sessions.
2. **Skills only for v1.** Prompt templates deferred. Wrapper machinery generalises later if pain emerges.
3. **firstMessage parse server-side.** Originally proposed client-side; revised after discovering the 200-char truncation cuts the wrapper in half. Parser lives in `packages/shared` so server and client both consume.
4. **Up-arrow recalls condensed only.** No double-tap-for-expanded escape hatch. "Copy as Markdown" remains the path to the expanded form for users who explicitly want it.
5. **Visual treatment: distinct card, full slash command always visible, collapsed by default, no feature flag.** A different border tint and a wrench icon teach users this is a skill invocation, the full `/skill:name args` is always visible (so the user learns what to type to invoke it again), the body collapses by default to keep chat readable, and we ship it without a kill switch since there's no schema risk.
