## ADDED Requirements

### Requirement: Watchdog tracks spawned sessions with three indices: token, pid, cwd
The `SpawnRegisterWatchdog` SHALL maintain a third internal index alongside the existing `byCwd` and `byPid` maps:

- `byToken: Map<string, Entry>` — populated when `spawnToken` is provided to `arm`.

The `arm` signature SHALL be extended to accept `spawnToken?: string`:

```ts
arm({ pid?, cwd, mechanism, logPath?, ws, spawnToken? }): void
```

When `spawnToken` is provided at arm time, the entry SHALL be indexed in `byToken` in addition to `byCwd` and (if `pid` is provided) `byPid`. All three indices SHALL point to the same `Entry` object.

A new `clearByToken(token)` method SHALL be exposed. It SHALL cancel the entry's timer and remove the entry from ALL THREE maps when invoked. Like `clearByPid` / `clearByCwd`, calling `clearByToken` with an unknown key SHALL be a no-op.

The pi-gateway `session_register` handler SHALL invoke clears in priority order: `clearByToken(msg.spawnToken)` first (when present), then `clearByPid(msg.pid)` (when present), then `clearByCwd(msg.cwd)` unconditionally. The first successful clear short-circuits the rest, but invoking subsequent `clear*` calls on already-removed indices SHALL still be safe (no-op).

#### Scenario: Token clear cancels the watchdog
- **WHEN** `watchdog.arm({ cwd: "/p", spawnToken: "tok_a", pid: 100, mechanism: "headless", ws })` is called
- **AND** `watchdog.clearByToken("tok_a")` is called within `timeoutMs`
- **THEN** the timer SHALL be cancelled
- **AND** the entry SHALL be removed from `byToken`, `byCwd`, and `byPid`
- **AND** no `spawn_register_timeout` SHALL be emitted

#### Scenario: Token-clear is idempotent across cleared indices
- **WHEN** `clearByToken("tok_a")` has already removed the entry
- **AND** `clearByPid(100)` is then called for the same pid
- **THEN** the second call SHALL be a no-op (entry already removed)

#### Scenario: Tmux arm with token uses token clear
- **WHEN** `watchdog.arm({ cwd: "/p", spawnToken: "tok_b", mechanism: "tmux", ws })` (no pid) is called
- **AND** `watchdog.clearByToken("tok_b")` is called
- **THEN** the timer SHALL be cancelled and `byToken` and `byCwd` SHALL no longer contain the entry

#### Scenario: Legacy spawn without token still works
- **WHEN** `watchdog.arm({ cwd: "/p", pid: 100, mechanism: "headless", ws })` (no spawnToken) is called
- **THEN** only `byCwd` and `byPid` SHALL contain the entry
- **AND** existing `clearByPid` / `clearByCwd` semantics SHALL be unchanged

#### Scenario: Token reuse cancels prior arm
- **WHEN** `arm({ ..., spawnToken: "tok_x" })` is called twice with the same token (programmatic mistake)
- **THEN** the first arm's timer SHALL be cancelled before the second arm installs its entry
- **AND** all three indices SHALL point to the second arm's entry

### Requirement: Late-recovery window keyed by token
The watchdog's `recentlyFired` map SHALL also key by `spawnToken` when the fired entry had one. When a late `clearByToken` is called for a key in `recentlyFired`, the watchdog SHALL emit `spawn_register_recovered { cwd, pid?, requestId? }` to the originally-stored `ws` exactly as it does for late `clearByPid` / `clearByCwd` cases.

#### Scenario: Late token-bearing register triggers recovery
- **WHEN** a watchdog entry with `spawnToken: "tok_y"` fires its timeout (entering `recentlyFired`)
- **AND** `clearByToken("tok_y")` is called within 60s after the fire
- **THEN** a `spawn_register_recovered` event SHALL be emitted to the original `ws`
