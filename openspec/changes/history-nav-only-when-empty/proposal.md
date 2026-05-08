## Why

The chat input currently activates history recall on `ArrowUp` / `ArrowDown` whenever the caret is on the first/last visual line. In practice this collides with cursor navigation while editing a multi-line draft: pressing `↑` from the first line of an in-progress draft replaces the draft with a previous prompt instead of moving the cursor. Users expect `↑`/`↓` to navigate the cursor while there is text in the input, and only recall history when the input is actually empty (bash-style).

## What Changes

- Tighten the gating rule for history navigation in `CommandInput`: `ArrowUp` / `ArrowDown` SHALL trigger history recall only when the input is **completely empty** (no text, no pending images), instead of the current "caret on first/last visual line" rule.
- Add an explicit force-history shortcut: `Ctrl+ArrowUp` / `Ctrl+ArrowDown` (and `Cmd+ArrowUp` / `Cmd+ArrowDown` on macOS) SHALL invoke history recall regardless of input content. The pre-recall content is captured as the in-progress draft (existing behavior).
- Update `chat-input-state` spec accordingly. Existing draft preservation, escape-to-restore, and session-switch-reset semantics are unchanged.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `chat-input-state`: history navigation gating rule changes from "caret on first/last visual line" to "input completely empty"; new requirement adds modifier-key force-history shortcut.

## Impact

- Code: `packages/client/src/components/CommandInput.tsx` (key handler), `packages/client/src/components/__tests__/CommandInput.test.tsx`, `packages/client/src/__tests__/chat-input-draft-integration.test.tsx`.
- The helpers `isCaretOnFirstLine` / `isCaretOnLastLine` become unused for the gating decision; they may be removed if no remaining call sites exist.
- No protocol, server, or persistence changes. No migration. Behavior change is client-only and ships in the next client build; rollback is reverting the client diff.
