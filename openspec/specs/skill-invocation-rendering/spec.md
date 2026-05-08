# skill-invocation-rendering Specification

## Purpose
Defines how the dashboard recognises, persists, and renders pi skill invocations (`/skill:name args` slash commands) as a first-class, recoverable structure spanning bridge, server, and client. Aligns the dashboard's bridge expander to pi's `<skill name="..." location="...">…</skill>` envelope so a single regex recovers the slash form for chat rendering, ↑ history recall, and `firstMessage` display/search.

## Requirements


### Requirement: Bridge expander wraps skill expansions in <skill> blocks

The dashboard's bridge prompt-expander (`expandPromptTemplateFromDisk` in `packages/extension/src/prompt-expander.ts`) SHALL wrap skill expansions in the same `<skill>` envelope pi's `_expandSkillCommand` produces. Wrapping applies whenever the resolved template is a skill (the local-scan key starts with `skill:` OR the `pi.getCommands()` fallback returns a command with `source === "skill"`). The exact byte format SHALL be:

```
<skill name="${name}" location="${filePath}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>${userArgs ? "\n\n" + userArgs : ""}
```

where `name` is the bare skill name (without the `skill:` prefix), `filePath` is the absolute path to `SKILL.md`, `baseDir` is `dirname(filePath)`, and `body` is the result of stripping the YAML frontmatter from `SKILL.md` then calling `.trim()`.

#### Scenario: Skill with arguments produces wrapper plus trailing args
- **WHEN** the bridge expands `/skill:foo args here` and resolves to `/x/foo/SKILL.md` with body `Hello\nWorld`
- **THEN** the expanded text SHALL equal `<skill name="foo" location="/x/foo/SKILL.md">\nReferences are relative to /x/foo.\n\nHello\nWorld\n</skill>\n\nargs here`

#### Scenario: Skill without arguments produces wrapper without trailing args
- **WHEN** the bridge expands `/skill:foo` (no args) and resolves to `/x/foo/SKILL.md` with body `body`
- **THEN** the expanded text SHALL end with `\n</skill>` and SHALL NOT contain a trailing `\n\n…` after the closing tag

#### Scenario: Plain prompt template is not wrapped
- **WHEN** the bridge expands `/opsx-continue my-change` and resolves to `.pi/prompts/opsx-continue.md` (a non-skill template)
- **THEN** the expanded text SHALL be the un-wrapped body plus `\n\nmy-change`, with no `<skill>` tag

#### Scenario: Output is byte-identical to pi's _expandSkillCommand for the same inputs
- **WHEN** the dashboard bridge wraps a skill `/skill:openspec-explore foo` against the same `SKILL.md` pi reads
- **THEN** the output SHALL be byte-identical to what pi's `_expandSkillCommand` would produce

### Requirement: parseSkillBlock recovers structure from a wrapped message

A pure function `parseSkillBlock(text: string): SkillBlock | null` SHALL be exported from `packages/shared/src/skill-block-parser.ts`. It SHALL match the regex `^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$` against the input. On match it SHALL return `{ name, location, body, args, condensed }` where `condensed = "/skill:" + name + (args ? " " + args : "")`. On no match it SHALL return `null`.

#### Scenario: Well-formed wrapper with args
- **WHEN** `parseSkillBlock(\`<skill name="foo" location="/x/SKILL.md">\nbody\n</skill>\n\nargs here\`)` is called
- **THEN** the return value SHALL be `{ name: "foo", location: "/x/SKILL.md", body: "body", args: "args here", condensed: "/skill:foo args here" }`

#### Scenario: Wrapper without args
- **WHEN** `parseSkillBlock(\`<skill name="foo" location="/x">\nbody\n</skill>\`)` is called
- **THEN** `args` SHALL be `undefined` and `condensed` SHALL equal `"/skill:foo"`

#### Scenario: Plain text returns null
- **WHEN** `parseSkillBlock("Hello, this is just text.")` is called
- **THEN** the return value SHALL be `null`

#### Scenario: Mid-document <skill> text returns null (anchor enforcement)
- **WHEN** `parseSkillBlock("prefix\n<skill name=\"foo\" location=\"/x\">\nbody\n</skill>")` is called
- **THEN** the return value SHALL be `null` because the wrapper does not start at the input boundary

#### Scenario: Body containing literal <skill> text does not terminate prematurely
- **WHEN** the wrapped body contains documentation like `Documented like: <skill name="example">…</skill>`
- **THEN** `parseSkillBlock` SHALL extend the match to the outermost `</skill>` boundary and return the full documented body in `body`

#### Scenario: Multi-line user args are preserved
- **WHEN** the args block contains `line1\nline2\nline3`
- **THEN** `args` SHALL equal `"line1\nline2\nline3"` (newlines preserved verbatim)

### Requirement: buildSkillBlock and parseSkillBlock round-trip

A pure function `buildSkillBlock({ name, filePath, baseDir, body, userArgs })` SHALL be exported from `packages/shared/src/skill-block-parser.ts`. The output SHALL satisfy `parseSkillBlock(buildSkillBlock(input)) !== null` and the parsed `name`, `body`, and `args` SHALL equal the input `name`, `body`, and `userArgs`.

#### Scenario: Round-trip with args
- **WHEN** `buildSkillBlock({ name: "foo", filePath: "/x/SKILL.md", baseDir: "/x", body: "Body line", userArgs: "the args" })` is called
- **AND** the result is passed to `parseSkillBlock`
- **THEN** the parsed result SHALL have `name === "foo"`, `body === "Body line"`, `args === "the args"`

#### Scenario: Round-trip without args
- **WHEN** `buildSkillBlock({ name: "foo", filePath: "/x/SKILL.md", baseDir: "/x", body: "Body" })` is called (no `userArgs`)
- **AND** the result is passed to `parseSkillBlock`
- **THEN** the parsed `args` SHALL be `undefined`

### Requirement: ChatMessage carries optional skill metadata

The client `ChatMessage` interface (`packages/client/src/lib/event-reducer.ts`) SHALL include an optional `skill?: { name: string; location: string; body: string; args: string | undefined }`. The reducer's `message_start` handler for `role === "user"` SHALL run `parseSkillBlock` on the extracted text content and, on match, populate `skill` with the parsed result. The raw `content` field SHALL remain the unmodified expanded string.

#### Scenario: Wrapped user message stamps skill
- **WHEN** the reducer receives `message_start` for a user message whose content is a well-formed `<skill>` wrapper
- **THEN** the resulting `ChatMessage` SHALL have `skill` populated and `content` SHALL equal the raw wrapped string

#### Scenario: Plain user message has undefined skill
- **WHEN** the reducer receives `message_start` for a user message whose content is plain text
- **THEN** the resulting `ChatMessage` SHALL have `skill === undefined`

#### Scenario: State-replay path also stamps skill
- **WHEN** an existing session's JSONL contains a wrapped user message and the reducer replays it through `state-replay → message_start`
- **THEN** the resulting `ChatMessage` SHALL have `skill` populated identically to the live path

### Requirement: Server-side firstMessage is condensed for skill invocations

`packages/server/src/session-discovery.ts` and `packages/server/src/session-scanner.ts` SHALL run `parseSkillBlock` on the first user message before truncating to 200 characters. When the parser matches, `firstMessage` SHALL equal `block.condensed.slice(0, 200)`. When the parser does not match, `firstMessage` SHALL equal the existing raw-content slice (current behavior).

#### Scenario: Wrapped first user message produces condensed firstMessage
- **WHEN** a session JSONL's first user message is `<skill name="openspec-explore" location="/abs/path">\nReferences are relative to /abs.\n\n<<long body>>\n</skill>\n\ncontinue with X`
- **THEN** `firstMessage` SHALL equal `"/skill:openspec-explore continue with X"` (truncated at 200 if longer)

#### Scenario: Plain first user message is unchanged
- **WHEN** a session JSONL's first user message is `"Hello world"`
- **THEN** `firstMessage` SHALL equal `"Hello world"`

#### Scenario: Wrapped condensed form longer than 200 chars is truncated to 200
- **WHEN** the parsed `condensed` value is 350 characters long
- **THEN** `firstMessage` SHALL equal `condensed.slice(0, 200)` (no ellipsis appended at the server)

### Requirement: SkillInvocationCard renders user messages with skill metadata

When the chat view renders a user message whose `ChatMessage.skill` is populated, it SHALL emit a `<SkillInvocationCard>` component instead of the regular `<MessageBubble>`. The card SHALL:

1. Always display the full `block.condensed` slash form (`/skill:name args`) in a header, never truncated.
2. Display a wrench icon in the header, visually marking it as a skill invocation distinct from regular user messages.
3. Use a distinct border tint different from regular user-bubble blue.
4. Default to collapsed state on initial render. Body and args SHALL NOT be visible until the user clicks the chevron toggle.
5. When expanded, render `skill.body` via the existing `MarkdownContent` component. When `skill.args` is set, append a horizontal-rule separator and render args text below.
6. Always display a footer with timestamp and **up to four** copy buttons:
   - "Copy as Markdown" — raw stored `content` (the full `<skill>...</skill>` wrapper plus args).
   - "Copy as plain text" — rendered DOM `innerText` of the body.
   - "Copy as command" — `block.condensed` (e.g. `/skill:foo args`).
   - **"Copy as message" — `block.args` verbatim. SHALL be hidden when `block.args` is `undefined` (no user-typed message to copy). Multi-line args are preserved as-is.**
7. Preserve the existing fork-from-message button when `entryId` and `onFork` are provided.

#### Scenario: Card shows full slash form in header
- **WHEN** a `SkillInvocationCard` renders for `skill = { name: "foo", args: "do the thing" }`
- **THEN** the header SHALL contain the literal text `/skill:foo do the thing` and SHALL NOT truncate it

#### Scenario: Card is collapsed by default
- **WHEN** a `SkillInvocationCard` is mounted without prior interaction
- **THEN** the body SHALL NOT be present in the DOM (or SHALL be `aria-hidden`)

#### Scenario: Chevron toggles body visibility
- **WHEN** the user clicks the chevron toggle on a collapsed card
- **THEN** the body SHALL become visible and the chevron SHALL update to the down-arrow form
- **AND WHEN** the user clicks the chevron again
- **THEN** the body SHALL be hidden again

#### Scenario: Four copy buttons each copy the right content
- **WHEN** the user clicks "Copy as Markdown" on a skill card
- **THEN** the clipboard SHALL contain the raw stored `content` (the full `<skill>...</skill>` wrapper plus args)
- **AND WHEN** the user clicks "Copy as command"
- **THEN** the clipboard SHALL contain `block.condensed` (e.g. `/skill:foo args`)
- **AND WHEN** the user clicks "Copy as plain text"
- **THEN** the clipboard SHALL contain the rendered DOM `innerText` of the body
- **AND WHEN** the user clicks "Copy as message"
- **THEN** the clipboard SHALL contain `block.args` verbatim (the user-typed text after the skill name)

#### Scenario: Copy as message preserves multi-line args
- **WHEN** `skill.args` is `"line one\nline two\nline three"`
- **AND** the user clicks "Copy as message"
- **THEN** the clipboard SHALL contain `"line one\nline two\nline three"` exactly (newlines preserved)

#### Scenario: Copy as message button is hidden when args is undefined
- **WHEN** a `SkillInvocationCard` renders for `skill = { ..., args: undefined }`
- **THEN** the rendered DOM SHALL NOT contain a button with title `"Copy as message"`
- **AND** the other three copy buttons SHALL still be present

#### Scenario: Plain user message is unaffected
- **WHEN** a user message has `skill === undefined`
- **THEN** the chat view SHALL render the existing `<MessageBubble>` and SHALL NOT render a `SkillInvocationCard`
