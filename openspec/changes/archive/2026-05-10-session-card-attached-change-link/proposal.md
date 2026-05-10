## Why

When a session has an attached OpenSpec change, the session card shows the change badge but the session name doesn't reflect the attachment clearly. The card should display the attached change name as a visible, clickable link so users can quickly identify what change a session is working on.

## What Changes

- Session cards with an attached proposal SHALL display the change name prominently, linked or styled distinctly from the regular session name.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `openspec-card-section`: Session cards with attached proposals show the change name as a visible label/link.

## Impact

- **Client** (`packages/client/src/components/SessionCard.tsx`): Update card rendering to show attached change name.
