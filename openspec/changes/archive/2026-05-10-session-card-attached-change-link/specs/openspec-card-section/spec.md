## MODIFIED Requirements

### Requirement: Attached proposal display on session card
Session cards with an attached proposal SHALL display the change name as a clickable link that navigates to the corresponding change card in the OpenSpec section.

#### Scenario: Session with attached proposal
- **WHEN** a session has `attachedProposal` set
- **THEN** the session card SHALL display the change name styled as a clickable link with a proposal icon

#### Scenario: Clicking attached proposal link
- **WHEN** the user clicks the attached proposal link on a session card
- **THEN** the view SHALL scroll to the corresponding change card in the OpenSpec section

#### Scenario: Session without attached proposal
- **WHEN** a session has no `attachedProposal`
- **THEN** no proposal link SHALL be displayed

### Requirement: Change card scroll target
Each change card in the OpenSpec section SHALL have a unique identifier attribute based on the change name to support scroll-to navigation.

#### Scenario: Change card has identifier
- **WHEN** a change card is rendered in the OpenSpec section
- **THEN** it SHALL have a `data-change-name` attribute or `id` matching the change name
