## Context

Pi historically shipped a fork of `jiti` named `@mariozechner/jiti` (with `@oh-my-pi/jiti` as the alternate fork name for the `@oh-my-pi/pi-coding-agent` distribution). The dashboard's bridge extension runs inside pi's Node process, so the dashboard server resolves jiti via pi's process anchor (`process.argv[1]`) using `createRequire(...)`.

Pi 0.73.1 dropped the fork in favour of upstream `jiti` 2.7 — same author (`@pi0` co-maintains both), same API surface, same `lib/jiti-register.mjs` layout. The drop happens because the `@mariozechner/jiti` fork's reason-to-exist (custom Windows handling for `file://` URLs) was upstreamed into jiti 2.7. Once upstream had what pi needed, maintaining a fork was strict overhead.

`packages/shared/src/resolve-jiti.ts:JITI_PACKAGES` is the dashboard's hardcoded map of "where to look for jiti." Adding `"jiti"` to it is the entire fix. The build/spawn plumbing downstream of this resolver works in terms of an opaque `file://` URL — it doesn't care which package the URL came from.

## Goals / Non-Goals

**Goals:**
- Restore dashboard startup for users on pi 0.73.1+ without breaking users still on pi ≤ 0.73.0.
- Avoid scope creep: this is a bug-driven one-line fix, not a refactor.

**Non-Goals:**
- Removing the `@mariozechner/jiti` / `@oh-my-pi/jiti` entries. Some users will linger on pi 0.72.x for weeks; their jiti is still the fork. Both names must keep resolving.
- Inferring jiti location from pi's own `package.json#dependencies`. The current resolver walks Node's module resolution, which is canonical and right.
- Reading pi's version to decide which jiti name to look for. The lookup order is cheap; just try all three.

## Decisions

### 1. Lookup order: forks first, then upstream

**Decision:** the new `JITI_PACKAGES` is `["@mariozechner/jiti", "@oh-my-pi/jiti", "jiti"]`. Forks first, upstream last.

**Why:** legacy users (pi ≤ 0.73.0) have a fork installed. Trying the fork first is one `req.resolve()` call that succeeds immediately for them — no perf cost. New users (pi 0.73.1+) fall through to `"jiti"` after two miss-throws (also cheap). Putting upstream first would marginally favour new users at the cost of forcing legacy users through two failed lookups before success — a wash, but the semantic contract "forks were the original; upstream is the new default" is clearer with forks first.

**Alternative considered:** detecting pi's version and picking the right one. Rejected — adds a `package.json` read for negligible perf win, complicates the function, hard to test cleanly.

### 2. No change to `buildJitiRegisterUrl`

**Decision:** the helper that converts a `package.json` path into a `file://` URL for the register hook is unchanged.

**Why:** verified upstream jiti 2.7's `lib/jiti-register.mjs` exists at the same path the helper assumes (`<pkg>/lib/jiti-register.mjs`). The helper's Windows drive-letter handling, file-URL construction, and POSIX path joining all apply identically.

### 3. No change to the spawn / argv plumbing

**Decision:** consumers of `resolveJitiImport()` and `resolveJitiFromAnchor()` are untouched.

**Why:** the contract is "return a `file://` URL pointing at a jiti register hook." The helper continues to honour that contract for upstream jiti — only the package whose hook is returned changes. `node --import <url>` doesn't care.

## Risks / Trade-offs

- **[Risk]** Upstream jiti adds a major version (3.x) with a different register-hook path. → **Future concern.** Until then, the layout is stable. If/when jiti 3.x ships, `buildJitiRegisterUrl` needs to detect the new path; the resolver list is unaffected.
- **[Trade-off]** Three lookups instead of two. Negligible (each is O(1) module resolution). The old code already did two; one more is not a regression.

## Migration Plan

Pure additive code change. No data migration. Server restart picks up the new resolver immediately. No client invalidation needed (the resolver runs before the server even binds its port).

Rollback: revert the diff. Single file (`resolve-jiti.ts`).
