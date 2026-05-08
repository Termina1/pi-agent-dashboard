## 1. Shared parser

- [x] 1.1 Create `packages/shared/src/skill-block-parser.ts` exporting `parseSkillBlock(text)` and `buildSkillBlock(args)` with the contracts in design.md §"The parser contract."
- [x] 1.2 Author `packages/shared/src/__tests__/skill-block-parser.test.ts` with 9+ cases covering match / no-match / partial / nested literal `<skill>` / multiline args / body-with-frontmatter / round-trip / pi-byte-parity. (16 tests authored, all green.)
- [x] 1.3 No barrel needed — `packages/shared/package.json` uses wildcard exports (`./*.js`), so `@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js` resolves automatically.
- [x] 1.4 Verify all tests pass: `HOME=$(mktemp -d) npx vitest run packages/shared/src/__tests__/skill-block-parser.test.ts` → 16/16 green.

## 2. Bridge expander wraps skill output

- [x] 2.1 Modify `packages/extension/src/prompt-expander.ts::expandPromptTemplateFromDisk`. Skill-source detection added via `isSkillResolution(templateName, filePath, pi)`; when true, wraps via `buildSkillBlock` from `@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js`.
- [x] 2.2 Bare skill name passed via `templateName.replace(/^skill:/, "")`.
- [x] 2.3 `baseDir = dirname(filePath)` (imported `dirname` from `node:path`).
- [x] 2.4 `body = readTemplate(filePath)` unchanged.
- [x] 2.5 Plain prompt templates fall through to the original concatenation path; existing tests for `/opsx-continue`, `/opsx:continue`, `/opsx:apply`, `/hello` all green.
- [x] 2.6 Tests added (skill with args / skill no args / template hyphen / template colon-alias all cover the matrix). 10/10 prompt-expander tests pass.
- [x] 2.7 Whole extension test suite green (544/544).

## 3. Server-side firstMessage condensation

- [x] 3.1 `session-discovery.ts` extractor calls `condenseForFirstMessage(text, 200)` (helper added to `skill-block-parser.ts`).
- [x] 3.2 `session-scanner.ts` extractor calls the same helper.
- [x] 3.3 Tests authored in `__tests__/session-discovery-skill-firstmessage.test.ts` (5 cases: wrapped→condensed, long-condensed truncated to 200, plain unchanged, broken wrapper falls through, end-to-end source check). All green.
- [x] 3.4 Whole server suite green (1467/1467).
- [x] 3.5 No regressions in display-name / filterByQuery tests.

## 4. Client-side ChatMessage stamp

- [x] 4.1 `ChatMessage.skill?: SkillBlock` added (re-exports the type from shared parser).
- [x] 4.2 `message_start` handler runs `parseSkillBlock(text)` and includes `skill` in the pushed `ChatMessage`. Raw `content` preserved.
- [x] 4.3 Tests authored in `event-reducer-skill-stamp.test.ts` (4 cases: wrapped → stamp, plain → undefined, with-images, string-content shape). All green.
- [x] 4.4 Stamp tests + history tests pass; whole client suite verified below in 5.3.

## 5. Client-side history recall

- [x] 5.1 `extractUserPromptHistory` prefers `msg.skill?.condensed`, falls back to ad-hoc `parseSkillBlock(content)?.condensed`, then raw `content`.
- [x] 5.2 Tests authored: with-args, no-args, fallback path (no stamp), mixed history. All green.
- [x] 5.3 Existing slash-command / bang-shell / dedup tests still pass (12/12).

## 6. SkillInvocationCard component

- [x] 6.1 `SkillInvocationCard.tsx` created.
- [x] 6.2 Prop contract matches: `{ skill, rawContent, timestamp?, entryId?, className?, onFork? }`.
- [x] 6.3 Card layout: wrench (`mdiTools`) header w/ chevron toggle; expandable body uses `MarkdownContent`; args section with separator; footer with 3 copies + fork.
- [x] 6.4 Purple-tinted: `bg-purple-500/10 border-purple-400/30 border-l-2 border-l-purple-400`. Distinct from user bubble's blue.
- [x] 6.5 Tests authored (v1): 11 cases (header text, collapsed default, expand/collapse toggle, args section visibility, three copy buttons, copy targets, fork button, purple styling).
- [x] 6.6 Visual fidelity: deferred to manual smoke test in 9.3.

### 6.7 Smoke-test refinement — chevron-only toggle + "Copy as message" button

Discovered during smoke test: (a) the entire header was a `<button>`, hijacking mouse-text-selection so users couldn't drag-copy the args text; (b) existing 3 buttons cannot isolate the user's typed message. "Copy as Markdown" gives the XML wrapper; "Copy as plain text" gives body+args concatenated. The most common reader need ("copy what I asked") was not served.

- [x] 6.7.0 Header refactored: outer container is now a plain `<div>`; only the chevron is a `<button>` (with `aria-expanded` + `aria-label="Expand/Collapse skill body"`). Slash text wrapped in `<span class="... select-text">` so mouse-drag selects it natively.

- [x] 6.7.1 Fourth `<CopyButton>` added: icon `mdiMessageOutline`, title `"Copy as message"`, text=`skill.args`, only rendered when `skill.args` is truthy.
- [x] 6.7.2 Tests added: presence-when-args-set, hidden-when-args-undefined, click-copies-args-verbatim, multi-line preservation, chevron-only-toggle (5 new cases).
- [x] 6.7.3 SkillInvocationCard tests green (15/15). Wider client suite green (1486 passed).
- [x] 6.7.4 CHANGELOG `[Unreleased]` bullet updated to "four copy buttons" + chevron-only toggle note.

## 7. ChatView routing

- [x] 7.1 ChatView routes user messages with `msg.skill` to `<SkillInvocationCard>` while preserving `mt-4 mb-4 flex justify-end` and `bubbleMax` width on the wrapper. Plain user messages keep the existing blue bubble.
- [x] 7.2 ChatView tests extended with 2 new cases (skill-routes-to-card, plain-routes-to-bubble); 26/26 green.
- [x] 7.3 Manual smoke test passed: card renders, ↑ recalls slash form, copy buttons work; smoke surfaced two refinements (chevron-only toggle + Copy-as-message) that landed in §6.7.

## 8. Documentation

- [x] 8.1 `docs/file-index-shared.md` row added for `skill-block-parser.ts` (alphabetical, before `state-replay.ts`).
- [x] 8.2 `docs/file-index-client.md` updated: new row for `SkillInvocationCard.tsx`, change-history pointer added to `ChatView.tsx`, `event-reducer.ts`, `message-history.ts`.
- [x] 8.3 `docs/file-index-server.md` updated: new row for `session-discovery.ts`; change-history pointer added to `session-scanner.ts`.
- [x] 8.4 `docs/file-index-extension.md` updated: change-history pointer added to `prompt-expander.ts`.
- [x] 8.5 CHANGELOG `[Unreleased] / ### Added` bullet added (full description of user-facing impact).

## 9. Validation gates

- [x] 9.1 Full test suite green: 4455 passed, 9 skipped across 443 test files. Log saved at `/tmp/skill-collapse.log`.
- [x] 9.2 `npm run build` succeeded (Vite + precompress).
- [x] 9.3 Manual end-to-end passed (user-confirmed). Built, tested, verified.

## 10. Archive readiness

- [x] 10.1 `openspec validate render-skill-invocations-collapsibly` → valid.
- [x] 10.2 Spec deltas: `skill-invocation-rendering` (NEW capability — `## ADDED Requirements`); `chat-input-state` + `chat-view` (existing — `## MODIFIED Requirements`). Structure aligns with main specs.
- [x] 10.3 CHANGELOG updated under `[Unreleased] / ### Added`.
- [x] 10.4 Ready for archival via `openspec-archive-change`.
