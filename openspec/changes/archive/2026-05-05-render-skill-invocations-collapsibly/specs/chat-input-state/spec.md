## MODIFIED Requirements

### Requirement: Up-arrow recalls condensed slash form for skill invocations

The chat input's `ArrowUp` history-recall SHALL pull the most recently sent user prompts in newest-first order. When a user message was originally a skill invocation (its persisted content is wrapped in `<skill name="..." location="...">…</skill>`), the recall SHALL substitute the condensed slash form (`/skill:name args` or `/skill:name` if no args) for that entry. Plain user messages SHALL be recalled verbatim. The substitution SHALL apply at history-list construction time inside `extractUserPromptHistory(messages)` so `CommandInput` itself sees a uniform `string[]`.

This requirement supersedes the previous behavior in which `extractUserPromptHistory` returned the raw expanded body for every user message.

#### Scenario: Skill invocation with args is recalled as slash form
- **WHEN** the session contains a single user message whose stored content is `<skill name="openspec-explore" location="/x">\nbody\n</skill>\n\ncontinue with X`
- **AND** the user presses `ArrowUp` in an empty input
- **THEN** the input SHALL contain `/skill:openspec-explore continue with X`

#### Scenario: Skill invocation without args is recalled as bare slash form
- **WHEN** the session contains a single user message whose stored content is `<skill name="openspec-explore" location="/x">\nbody\n</skill>`
- **AND** the user presses `ArrowUp` in an empty input
- **THEN** the input SHALL contain `/skill:openspec-explore`

#### Scenario: Plain user messages are recalled verbatim
- **WHEN** the session's user-message history (newest-first) is `["fix the bug", "/compact", "!ls -la"]`
- **AND** the user presses `ArrowUp` repeatedly
- **THEN** the input SHALL contain `"fix the bug"`, then `"/compact"`, then `"!ls -la"`, in that order

#### Scenario: Mixed history preserves newest-first ordering and dedupes consecutive equals
- **WHEN** the session contains messages in order: `<skill foo>`, plain `"check it"`, `<skill foo>` (again, non-consecutive duplicate), `"check it"` (consecutive duplicate)
- **THEN** `extractUserPromptHistory` SHALL return `["check it", "/skill:foo", "check it", "/skill:foo"]` (newest-first, consecutive collapsing applied to the condensed strings, non-consecutive duplicates preserved)
