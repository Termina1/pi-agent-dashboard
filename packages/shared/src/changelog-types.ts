/**
 * Shared types for the pi changelog display feature.
 *
 * Server parses `CHANGELOG.md` files installed alongside core packages
 * and the client renders the result via `WhatsNewDialog`. These types
 * are the wire contract between the two halves.
 *
 * See change: pi-update-whats-new-panel.
 */

/**
 * One bullet point under a release section. Preserves the original
 * markdown prose verbatim so issue/PR links and inline code formatting
 * survive intact for the client renderer.
 */
export interface ChangelogBullet {
  /**
   * Original markdown text of the bullet, with the leading `- `
   * removed and any continuation lines joined with `\n`. Inline
   * markdown (links, code spans, emphasis) is preserved exactly as
   * written so the client can hand it to a markdown renderer.
   */
  text: string;
  /**
   * Issue / PR references mined from the prose via the canonical
   * `([#NNN](URL))` pattern pi uses at end-of-bullet. May be empty
   * when no such pattern is found. Order matches occurrence order.
   * The `text` field still contains the link in its original form.
   */
  issues: { num: number; url: string }[];
}

/**
 * One release entry parsed from a Keep-a-Changelog-style markdown
 * document. Typed sub-section arrays are populated only when the
 * corresponding H3 heading is present in the source.
 */
export interface ChangelogRelease {
  /**
   * Version string lifted from the `## [<version>] - <date>` H2
   * heading. The bracket contents are taken verbatim so versions
   * like `0.4.3-rc.1` survive.
   */
  version: string;
  /**
   * Date string lifted from the H2 heading. Set to `null` when the
   * date token is missing or fails to parse as a YYYY-MM-DD-ish form.
   * Parser tolerance is intentional — pi has shipped rare entries
   * with date ranges or missing dates.
   */
  date: string | null;
  /** Bullets under `### Breaking Changes`, in source order. */
  breaking: ChangelogBullet[];
  /**
   * Union of bullets under `### New Features` and `### Added`. Pi
   * uses both labels at different times for the same concept, so
   * we merge them. Source order is preserved within each sub-section
   * and the two sub-sections are concatenated in source order.
   */
  features: ChangelogBullet[];
  /** Bullets under `### Changed`. */
  changed: ChangelogBullet[];
  /** Bullets under `### Fixed`. */
  fixed: ChangelogBullet[];
  /**
   * Full markdown text from the release's H2 line up to (but not
   * including) the next H2 line. Retained as a fallback render path
   * when the typed arrays don't capture the content (e.g. an
   * unrecognized H3 heading).
   */
  raw: string;
}

/**
 * Response shape for `GET /api/pi-core/changelog`. Always wraps the
 * filtered release list in this envelope so the client gets the
 * derived `hasBreaking` flag and the GitHub link in one round-trip.
 */
export interface ChangelogResponse {
  /** Package the changelog was parsed for. */
  pkg: string;
  /**
   * Lower bound of the version range, EXCLUSIVE. Echoes the request
   * query param. Releases at or below this version are filtered out.
   */
  from: string;
  /**
   * Upper bound of the version range, INCLUSIVE. Echoes the request
   * query param. Releases above this version are filtered out.
   */
  to: string;
  /**
   * Filtered release list, ordered with the latest version FIRST.
   * Empty when no releases exist in `(from, to]` or when the
   * CHANGELOG could not be located.
   */
  releases: ChangelogRelease[];
  /**
   * Convenience flag derived from `releases.some(r => r.breaking.length > 0)`.
   * Lets the client render the warning icon without re-walking the array.
   */
  hasBreaking: boolean;
  /**
   * Public URL to the full CHANGELOG on GitHub, derived from the
   * package's `repository` field. `null` when the repository is not
   * GitHub-hosted or is unparseable.
   */
  changelogUrl: string | null;
  /** ISO timestamp at which the parser produced this response. */
  parsedAt: string;
}
