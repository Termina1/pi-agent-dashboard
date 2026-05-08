/**
 * Filesystem helpers for locating an installed package's
 * `CHANGELOG.md` and `package.json`, plus deriving a public GitHub
 * URL from the `repository` field.
 *
 * Search order matches the ToolRegistry resolution chain for `pi`:
 *   1. Managed install (`~/.pi-dashboard/node_modules/<pkg>/`)
 *   2. Bare-import via `createRequire` (process resolves the package
 *      through its own node_modules — covers npm-global on Unix when
 *      the symlink lands inside this Node prefix, and dev-checkout
 *      paths during local builds).
 *
 * Both helpers return `null` rather than throwing on absence so route
 * handlers can degrade to the empty-changelog response per spec
 * `pi-changelog-display#Scenario: Package not installed returns empty`.
 *
 * See change: pi-update-whats-new-panel.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

/** Default managed install root. Test seam: caller may override. */
function defaultManagedDir(): string {
  return path.join(os.homedir(), ".pi-dashboard");
}

/**
 * Locate a package's CHANGELOG.md on disk.
 *
 * Returns `{ changelogPath, packageDir }` so callers can read the
 * adjacent `package.json` without re-resolving.
 *
 * Strategy:
 *   1. `<managedDir>/node_modules/<pkg>/CHANGELOG.md` (Electron + CLI bootstrap).
 *   2. `createRequire(import.meta.url).resolve("<pkg>/package.json")` then
 *      look for `CHANGELOG.md` next to it (covers bare-import / npm-global
 *      via the standard Node resolution mechanism).
 *
 * Returns `null` when no readable CHANGELOG can be located.
 */
export interface ChangelogLocation {
  changelogPath: string;
  packageDir: string;
}

export interface FindOptions {
  /** Override managed dir for tests. */
  managedDir?: string;
  /**
   * Override the require-resolver used for bare-import lookup. Tests
   * pass a stub that throws to force the managed path; production
   * uses `createRequire(import.meta.url).resolve`.
   */
  resolveBareImport?: (pkgJsonSpec: string) => string;
}

export function findChangelogPath(
  pkg: string,
  opts: FindOptions = {},
): ChangelogLocation | null {
  // Strategy 1: managed install.
  const managedDir = opts.managedDir ?? defaultManagedDir();
  const managedPkg = path.join(managedDir, "node_modules", pkg);
  const managedCl = path.join(managedPkg, "CHANGELOG.md");
  if (fs.existsSync(managedCl)) {
    return { changelogPath: managedCl, packageDir: managedPkg };
  }

  // Strategy 2: bare-import via require.resolve.
  const resolver =
    opts.resolveBareImport ??
    ((spec: string) => createRequire(import.meta.url).resolve(spec));
  try {
    const pkgJsonPath = resolver(`${pkg}/package.json`);
    const dir = path.dirname(pkgJsonPath);
    const cl = path.join(dir, "CHANGELOG.md");
    if (fs.existsSync(cl)) {
      return { changelogPath: cl, packageDir: dir };
    }
  } catch {
    /* not resolvable — fall through */
  }

  return null;
}

/**
 * Read and parse `package.json` next to a previously-located
 * CHANGELOG. Returns the parsed object or `null` on read/parse error.
 */
export function readPackageJson(packageDir: string): Record<string, unknown> | null {
  const p = path.join(packageDir, "package.json");
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Derive a public GitHub URL pointing at the CHANGELOG given a
 * `package.json#repository` field. Returns `null` when the field is
 * missing, not GitHub-hosted, or unparseable.
 *
 * Accepted shapes (per spec `pi-changelog-display#Requirement: Changelog URL derivation`):
 *   - `"github:org/repo"` shorthand
 *   - `"https://github.com/org/repo.git"` URL string
 *   - `{ "type": "git", "url": "git+https://github.com/org/repo.git" }`
 *   - same object form with optional `"directory": "packages/foo"` (monorepo)
 */
export function deriveChangelogUrl(repository: unknown): string | null {
  if (!repository) return null;

  let urlStr: string | null = null;
  let directory: string | null = null;

  if (typeof repository === "string") {
    urlStr = repository;
  } else if (typeof repository === "object" && repository !== null) {
    const rec = repository as Record<string, unknown>;
    if (typeof rec.url === "string") urlStr = rec.url;
    if (typeof rec.directory === "string" && rec.directory.length > 0) {
      directory = rec.directory.replace(/^\/+|\/+$/g, "");
    }
  }
  if (!urlStr) return null;

  const m = parseGitHubUrl(urlStr);
  if (!m) return null;

  const subPath = directory ? `${directory}/` : "";
  return `https://github.com/${m.org}/${m.repo}/blob/main/${subPath}CHANGELOG.md`;
}

/**
 * Parse the various GitHub URL forms used in `package.json#repository`
 * into `{ org, repo }`. Returns null for non-GitHub or unparseable
 * inputs.
 */
function parseGitHubUrl(s: string): { org: string; repo: string } | null {
  const trimmed = s.trim();

  // github:org/repo shorthand
  let m = trimmed.match(/^github:([^/]+)\/([^/#]+)/i);
  if (m) return { org: m[1], repo: stripGitSuffix(m[2]) };

  // git+https://github.com/org/repo.git
  // https://github.com/org/repo
  // git://github.com/org/repo.git
  // ssh://git@github.com/org/repo.git
  // git@github.com:org/repo.git
  m = trimmed.match(/(?:^|[/@:])github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (m) return { org: m[1], repo: stripGitSuffix(m[2]) };

  return null;
}

function stripGitSuffix(repo: string): string {
  return repo.replace(/\.git$/i, "");
}
