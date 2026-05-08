## Context

`CommandInput` (`packages/client/src/components/CommandInput.tsx`) is a multi-line `<textarea>` that supports two overlapping `ArrowUp` / `ArrowDown` semantics:

1. Native textarea cursor movement between lines.
2. Bash-style history recall over previously sent user prompts in the current session.

Today the handler delegates between the two using `isCaretOnFirstLine` / `isCaretOnLastLine`. This works for single-line drafts but fights the user on multi-line drafts: pressing `↑` from the first line of "line one\nline two" replaces the draft with a recalled prompt because there is "no line above" to move to. Users expect `↑`/`↓` to behave like an editor while there is content, and only recall history when the input is empty (matching shells like bash, zsh, and fish in their default mode).

Existing related semantics are spec'd in `chat-input-state`:
- Per-session draft persistence in `localStorage`.
- Per-session pending image attachments (in-memory).
- In-progress draft buffer and `Escape` restoration during history navigation.
- Session-switch resets history nav state.

## Goals / Non-Goals

**Goals:**
- Make `↑`/`↓` move the cursor whenever the input has content, eliminating the multi-line collision.
- Preserve a fast keyboard path to history recall without taking the mouse: `Ctrl+↑` / `Ctrl+↓` (and `Cmd+↑` / `Cmd+↓` on macOS) force history navigation regardless of content.
- Keep all other history-mode semantics intact: in-progress draft buffer, `Escape` restoration, walk-past-newest restores draft, editing-keystroke exits history mode, session switch resets state.

**Non-Goals:**
- Searching history (`Ctrl+R` style). Out of scope.
- Persisting history across sessions or reloads beyond what already exists (history is derived from the session's chat messages).
- Any change to autocomplete dropdown semantics or pending-prompt gating.
- Touch / mobile gestures for history.

## Decisions

### D1. Gating rule: "completely empty" rather than "caret at line boundary"

The condition that activates history recall on a bare `↑` / `↓` press changes to:

> The textarea's `value` is the empty string AND there are no pending image attachments.

Rationale: the caret-on-first/last-line heuristic is invisible to the user — they cannot tell from looking at the input whether `↑` will move the cursor or replace their draft. "Empty" is unambiguous and matches shell history conventions. Pending images count toward "non-empty" because they represent unsent content the user would lose if a recalled prompt overwrote the input state.

**Alternatives considered:**
- *Keep first/last-line heuristic.* Rejected: the original complaint.
- *Caret at start (`↑`) / end (`↓`) of text, regardless of empty.* Rejected: still surprising in single-line drafts where the caret naturally sits at the end after typing.
- *Empty-only with no escape hatch.* Rejected: power users want a no-mouse path to history; the modifier shortcut adds <10 lines and does not interfere with typing.

### D2. Force-history modifier: `Ctrl+↑` / `Ctrl+↓` (and `Cmd+↑` / `Cmd+↓`)

When `event.ctrlKey || event.metaKey` is true on `ArrowUp` / `ArrowDown`, the handler bypasses the empty-only check and runs the existing history recall path. The current input content (if any) is captured as the in-progress draft on first invocation, exactly as today.

Rationale: `Ctrl+↑/↓` is unbound in standard textarea behavior on Linux/Windows; `Cmd+↑/↓` jumps to document start/end on macOS, which is irrelevant for a small composer. Recognizing both keeps cross-platform parity without conflict.

**Alternatives considered:**
- *`Alt+↑/↓`.* Rejected: Alt+arrow is used by some IMEs and OS-level word-jump bindings.
- *Dedicated keys (`PageUp` / `PageDown`).* Rejected: less discoverable, conflicts with future scrollback ideas.

### D3. Existing history-mode behavior is preserved verbatim

Once recall is activated (by either path), `↑`/`↓` without modifier continue to walk the history list, `Escape` restores the in-progress draft, walking past the newest entry restores the in-progress draft, and any non-arrow editing keystroke exits history mode. The change is purely about *entry* into history mode.

### D4. `isCaretOnFirstLine` / `isCaretOnLastLine` are removed if unused

The two helpers in `CommandInput.tsx` exist solely for the old gating rule. After the change they have no remaining call sites and SHALL be deleted to keep the file focused. If a future requirement needs them they can be reintroduced from git history.

## Risks / Trade-offs

- **[Risk]** Users with muscle memory from the current behavior press `↑` from a single-line draft expecting recall, get cursor-to-start instead. → **Mitigation**: this is a one-time relearn; the new rule matches shell conventions and is more predictable. No persistent setting to opt back in (would add config surface for a transient adjustment).
- **[Risk]** `Ctrl+↑/↓` on Linux/Windows could be intercepted by tiling window managers (e.g., GNOME workspace switch). → **Mitigation**: those bindings are user-configurable at the OS level; if `Ctrl+↑/↓` reaches the textarea it works, otherwise the user can clear the input to fall back to the default path. We do not need to register a second shortcut.
- **[Risk]** Pending images alone (no text) currently allow recall under the line-boundary rule (caret at line 0 of empty text). After the change, recall will not fire if images are attached. → **Mitigation**: this matches the user's mental model ("there is unsent content here") and avoids silently dropping image attachments when a recalled string overwrites the textarea. Documented in spec.
- **[Trade-off]** Removing the helpers reduces internal API surface but means anyone copying the old code from git will need to rewrite the gating logic. Acceptable; the helpers are 20 lines.

## Migration Plan

Pure client-side behavior change. Steps:

1. Land the diff in `CommandInput.tsx` and update tests.
2. `npm run build` + restart server (or rely on Vite HMR in dev).
3. Connected browsers pick up the new bundle on next reload.

**Rollback**: revert the commit; no persisted state, no protocol change, no server impact.

## Open Questions

_None._
