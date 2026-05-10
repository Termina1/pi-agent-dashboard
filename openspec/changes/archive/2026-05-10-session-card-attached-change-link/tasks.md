## 1. Change card scroll target

- [ ] 1.1 Add `data-change-name` attribute to each change card element in the OpenSpec section component

## 2. Clickable attached proposal badge

- [ ] 2.1 In `SessionCard.tsx`, replace the plain text `📋 {session.attachedProposal}` with a clickable link styled element
- [ ] 2.2 On click, scroll to the matching change card using `document.querySelector('[data-change-name="..."]')?.scrollIntoView()`
- [ ] 2.3 Style the link with colored text and underline on hover to distinguish it from plain text

## 3. Docs

- [ ] 3.1 Update AGENTS.md if needed
