## ADDED Requirements

### Requirement: Bridge pushes pi_version_update on activation and on change

The bridge SHALL read the pi-coding-agent version visible from inside the bridge's process at activation and once every 60 seconds thereafter. When the version differs from the previously-pushed value (including the initial push when no value has been sent), the bridge SHALL emit a `{ type: "pi_version_update", version }` message to the server.

The poll interval SHALL be cleared on bridge deactivation / WS disconnect, and reinstated on reactivation. The cached `lastPiVersion` SHALL be retained across deactivation so a reactivation against an unchanged pi version does not produce a redundant push.

#### Scenario: Initial push at activation
- **WHEN** the bridge activates against pi 0.73.0
- **THEN** the bridge SHALL emit `{ type: "pi_version_update", version: "0.73.0" }` to the server before any other version-related messages

#### Scenario: No push when version unchanged
- **WHEN** the 60-second timer fires and the bridge reads the same version as the last push
- **THEN** no `pi_version_update` message SHALL be sent

#### Scenario: Push after out-of-band upgrade
- **WHEN** the user runs `pi update --self` and the bridge's process now resolves to pi 0.74.0
- **AND** the 60-second timer fires
- **THEN** the bridge SHALL emit `{ type: "pi_version_update", version: "0.74.0" }`

#### Scenario: Read failure is silent
- **WHEN** the bridge's pi version read fails (e.g. transient fs error)
- **THEN** the bridge SHALL log a warning and skip the push without crashing the bridge or the timer

#### Scenario: Reactivation does not redundantly push
- **WHEN** the bridge deactivates after pushing version `0.73.0`
- **AND** the bridge reactivates against the same pi version
- **THEN** no `pi_version_update` SHALL be emitted because `lastPiVersion === "0.73.0"`
