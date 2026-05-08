## ADDED Requirements

### Requirement: Resolver supports upstream jiti package name
The jiti resolver SHALL support upstream `jiti` (bare package name, no scope) in addition to the legacy `@mariozechner/jiti` and `@oh-my-pi/jiti` fork names. The resolver SHALL try fork names FIRST, falling through to upstream `jiti` only when neither fork is resolvable. This preserves behaviour for users on pi ≤ 0.73.0 (fork-shipping) while adding compatibility for pi 0.73.1+ (upstream-shipping).

#### Scenario: Upstream jiti found when forks absent
- **WHEN** `resolveJitiImport()` runs with a Node module-resolution context where neither `@mariozechner/jiti/package.json` nor `@oh-my-pi/jiti/package.json` resolves
- **AND** `jiti/package.json` resolves to a valid path containing `lib/jiti-register.mjs`
- **THEN** the resolver SHALL return the `file://` URL of that register hook
- **AND** SHALL NOT throw

#### Scenario: Fork preferred over upstream when both present
- **WHEN** both `@mariozechner/jiti/package.json` and `jiti/package.json` resolve in the same context
- **THEN** the resolver SHALL return the URL pointing at `@mariozechner/jiti`'s register hook
- **AND** the upstream package SHALL NOT be queried

#### Scenario: All three providers absent
- **WHEN** none of `@mariozechner/jiti`, `@oh-my-pi/jiti`, `jiti` resolve
- **THEN** the resolver SHALL throw with the existing error message ("Cannot find pi's TypeScript loader (jiti). …")
- **AND** the error SHALL still mention `@mariozechner/pi-coding-agent` and `@oh-my-pi/pi-coding-agent` as potential install targets (existing message preserved)

#### Scenario: resolveJitiFromAnchor honours same lookup order
- **WHEN** `resolveJitiFromAnchor(anchorPath)` is called with an anchor whose Node module-resolution chain contains upstream `jiti` but neither fork
- **THEN** the function SHALL return the `file://` URL of the upstream register hook
- **AND** SHALL NOT return `null`
