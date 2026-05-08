## 1. Tests (TDD)

- [ ] 1.1 In `packages/client/src/components/__tests__/CommandInput.test.tsx`, add a failing test: pressing `ArrowUp` on a single-line non-empty draft does NOT replace the draft (no history recall).
- [ ] 1.2 Add a failing test: pressing `ArrowUp` on the first line of a multi-line draft does NOT trigger history recall (native cursor movement is preserved / the draft is not overwritten).
- [ ] 1.3 Add a failing test: pressing `ArrowUp` on an empty input DOES trigger history recall (most recent prompt populates the input).
- [ ] 1.4 Add a failing test: pressing `ArrowUp` when the textarea text is empty but a pending image is attached does NOT trigger history recall (input remains empty, image stays).
- [ ] 1.5 Add a failing test: pressing `Ctrl+ArrowUp` with non-empty text recalls the most recent prompt and preserves the prior text as the in-progress draft (verifiable via subsequent `Escape` restoring it).
- [ ] 1.6 Add a failing test: pressing `Cmd+ArrowUp` (metaKey) with non-empty text behaves the same as `Ctrl+ArrowUp`.
- [ ] 1.7 Add a failing test: `Ctrl+ArrowDown` walks forward in history and walking past the newest entry restores the in-progress draft.
- [ ] 1.8 Add a failing test: `Ctrl+ArrowUp` while the `/`-command dropdown is open does NOT trigger history recall (autocomplete still wins).
- [ ] 1.9 Add a failing test: `Ctrl+ArrowUp` while a prompt is pending does NOT trigger history recall.
- [ ] 1.10 Add a failing test: `Ctrl+ArrowUp` with empty text but a pending image attached recalls history AND preserves the pending image attachment.

## 2. Implementation

- [ ] 2.1 In `packages/client/src/components/CommandInput.tsx`, replace the bare-arrow gating in the history block: change condition from `isCaretOnFirstLine`/`isCaretOnLastLine` to `text === "" && images.length === 0` (with images defaulting to `[]` when undefined).
- [ ] 2.2 Add a force-history branch: if `(e.key === "ArrowUp" || e.key === "ArrowDown") && (e.ctrlKey || e.metaKey)` and the autocomplete-not-open + no-pending-prompt gates pass, run the existing recall path regardless of text/images content. Capture in-progress draft on first activation as today.
- [ ] 2.3 Ensure the force-history path preserves pending images (do NOT clear `images` when overwriting `text` with a recalled entry).
- [ ] 2.4 Remove `isCaretOnFirstLine` and `isCaretOnLastLine` and any now-unused imports / refs if no remaining call sites exist; otherwise keep them and note why.
- [ ] 2.5 Run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm all tests from §1 now pass.

## 3. Spec sync & verification

- [ ] 3.1 Re-read `openspec/changes/history-nav-only-when-empty/specs/chat-input-state/spec.md` and confirm every scenario maps to a test in §1.
- [ ] 3.2 Run `openspec validate history-nav-only-when-empty --strict` and resolve any warnings.
- [ ] 3.3 Manual smoke test: in the running dashboard, type a multi-line draft, press `↑` from line 1 — caret should stay on line 1 (no recall). Empty the input, press `↑` — most recent prompt appears. Type text again, press `Ctrl+↑` — recall fires; press `Esc` — typed text is restored.

## 4. Docs

- [ ] 4.1 Update the relevant row in `docs/file-index-client.md` for `CommandInput.tsx` if the change-history annotation policy applies (caveman style, one line).
- [ ] 4.2 No `AGENTS.md` change (behavior change is internal to a single component).
