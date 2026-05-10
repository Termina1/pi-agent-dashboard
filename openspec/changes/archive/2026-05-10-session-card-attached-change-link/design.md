## Context

Session cards show an attached proposal as a plain text badge (`📋 change-name`) below the OpenSpec activity area. The session's title bar shows `getSessionDisplayName()` which returns the session name (often auto-set to the change name on attach). However, the attached change name badge is small and unstyled — it doesn't link to anything or help the user navigate to the change in the OpenSpec section.

Currently, the session card name IS the change name (auto-renamed on attach), so the card title already shows the change name. The `📋 change-name` badge below is redundant text.

## Goals / Non-Goals

**Goals:**
- Make the attached change name badge on the session card a clickable link that scrolls to or highlights the change in the OpenSpec section
- Visually distinguish the attached change badge from plain text

**Non-Goals:**
- Changing session naming behavior
- Adding navigation to a separate change detail view

## Decisions

### 1. Style the attached proposal badge as a clickable link

**Decision**: Style the `📋 {session.attachedProposal}` text as a clickable element that scrolls to the corresponding change card in the OpenSpec section. Use a subtle link style (colored text, underline on hover).

**Rationale**: The OpenSpec section is in the same sidebar. Scrolling to the change card provides quick navigation without adding new views.

**Alternative considered**: Opening a modal or panel with change details — over-engineering for this use case.

### 2. Scroll target

**Decision**: Add a `data-change-name` or `id` attribute to each change card in the OpenSpec section. On click, use `document.querySelector` + `scrollIntoView` to navigate.

**Rationale**: Simple DOM-based scrolling, no state management needed.

## Risks / Trade-offs

- **OpenSpec section collapsed**: If the section is collapsed when the user clicks, the scroll target won't be visible. → Acceptable: user can expand and click again. Could auto-expand as a future enhancement.
