## MODIFIED Requirements

### Requirement: User message rendering routes skill invocations to SkillInvocationCard

The chat view SHALL render user messages whose `ChatMessage.skill` is populated using the `SkillInvocationCard` component. Plain user messages (those with `skill === undefined`) SHALL continue to render via the existing `MessageBubble` component. The container layout (right-justified flex, `mt-4 mb-4`, `bubbleMax` width constraint) SHALL be preserved across both branches.

This requirement supersedes the previous behavior in which all user messages rendered identically through `MessageBubble`.

#### Scenario: Skill user message renders as collapsed card
- **WHEN** the chat view encounters a user `ChatMessage` with `skill` populated
- **THEN** the rendered DOM SHALL contain a `<SkillInvocationCard>` element with the card's collapsed-by-default header showing `/skill:${name}${args ? " " + args : ""}` and a wrench icon

#### Scenario: Plain user message still renders as MessageBubble
- **WHEN** the chat view encounters a user `ChatMessage` with `skill === undefined`
- **THEN** the rendered DOM SHALL contain a `<MessageBubble>` element with the existing blue-bordered styling

#### Scenario: Mixed conversation renders both card types side-by-side
- **WHEN** the conversation includes one skill user message followed by one plain user message
- **THEN** the chat view SHALL render one `<SkillInvocationCard>` and one `<MessageBubble>` in chronological order
