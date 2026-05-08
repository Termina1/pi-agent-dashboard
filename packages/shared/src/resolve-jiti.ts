/**
 * Resolve the jiti register hook from pi's process context.
 *
 * can resolve it directly.
 *
 * Supported jiti providers, in lookup order:
 *   1. `@mariozechner/jiti` — legacy fork shipped with pi ≤ 0.73.0.
 *   2. `@oh-my-pi/jiti`     — fork shipped with `@oh-my-pi/pi-coding-agent`.
 *   3. `jiti`               — upstream package used by modern pi builds,
 *                              including `@earendil-works/pi-coding-agent`.
 *
 * Forks are tried first to preserve behaviour for users on older pi
 * versions; upstream is the fallthrough for pi 0.73.1+. See change:
 * support-upstream-jiti-resolution.
 */

import { createRequire } from "node:module";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Lookup order for jiti providers. Forks first (legacy pi ≤ 0.73.0),
 * upstream `jiti` last (pi 0.73.1+ / modern upstream-derived builds).
 * Exported so tests can verify the contract without mocking module resolution.
 */
export const JITI_PACKAGES = [
  "@mariozechner/jiti",
  "@oh-my-pi/jiti",
  "jiti",
] as const;

/**
 * Pure helper: given a jiti package.json path, return the file:// URL of
 * its register hook. Exported for testing — no I/O.
 *
 * Returns a file:// URL (not a raw path) because Node >= 20 on Windows
 * rejects raw absolute paths with a drive letter for --import (parses
 * "C:" / "B:" as a URL scheme → ERR_UNSUPPORTED_ESM_URL_SCHEME). file://
 * URLs are accepted on every OS.
 * See change: fix-windows-server-parity.
 */
export function buildJitiRegisterUrl(pkgJsonPath: string): string {
  // Detect Windows-style input (drive letter + backslash) regardless of
  // host OS, so unit tests can exercise the Windows path contract on macOS/Linux.
  // Production behaviour is unchanged because the host-OS `path`/`pathToFileURL`
  // match the input style automatically.
  const isWindowsStyle = /^[A-Za-z]:[\\/]/.test(pkgJsonPath);
  if (isWindowsStyle) {
    // Manually build file:///C:/path/lib/jiti-register.mjs — pathToFileURL on
    // POSIX hosts URL-encodes backslashes rather than treating them as
    // separators. Do the join with path.win32 and format the URL ourselves.
    const registerPath = path.win32.join(path.win32.dirname(pkgJsonPath), "lib", "jiti-register.mjs");
    return `file:///${registerPath.replace(/\\/g, "/")}`;
  }
  const registerPath = path.join(path.dirname(pkgJsonPath), "lib", "jiti-register.mjs");
  return pathToFileURL(registerPath).href;
}

/**
 * Test seam: a function that takes a package specifier (e.g.
 * `"jiti/package.json"`) and returns the resolved path. Production
 * supplies `createRequire(realpath(process.argv[1])).resolve`; tests
 * supply a stub.
 */
export type JitiResolver = (specifier: string) => string;

/**
 * Internal: walk the JITI_PACKAGES list using the given resolver and
 * return the first hit's register URL. Pure function once the
 * resolver is supplied. Returns null when no provider resolves.
 */
export function pickJitiRegisterUrl(resolver: JitiResolver): string | null {
  for (const jiti of JITI_PACKAGES) {
    try {
      const pkgJson = resolver(`${jiti}/package.json`);
      return buildJitiRegisterUrl(pkgJson);
    } catch { /* next */ }
  }
  return null;
}

/**
 * Returns jiti's register hook as a file:// URL suitable for `node --import`.
 * Uses process.argv[1] (pi's entry point) to anchor module resolution.
 *
 * The return value is ALWAYS a file:// URL (never a raw path). See
 * buildJitiRegisterUrl for the URL contract rationale.
 */
export function resolveJitiImport(): string {
  const anchor = process.argv[1];
  if (anchor) {
    try {
      // Resolve symlinks — process.argv[1] may be a symlink (e.g., bin/pi → dist/cli.js)
      const resolved = realpathSync(anchor);
      const req = createRequire(resolved);
      const url = pickJitiRegisterUrl((spec) => req.resolve(spec));
      if (url) return url;
    } catch { /* fall through */ }
  }

  throw new Error(
    "Cannot find pi's TypeScript loader (jiti). " +
    "Is @earendil-works/pi-coding-agent, @mariozechner/pi-coding-agent, or @oh-my-pi/pi-coding-agent installed?"
  );
}

/**
 * Resolve jiti's register hook from an arbitrary anchor path (e.g. a
 * pi-coding-agent package.json in a managed install, or a pi binary on
 * the system PATH). Returns a file:// URL or null if jiti cannot be
 * resolved from the anchor.
 *
 * This is the Electron/managed-install variant of `resolveJitiImport`
 * — the difference is the caller supplies the anchor explicitly
 * instead of using `process.argv[1]`. Consolidates what used to be a
 * duplicate `resolveJitiFromAnchor` in
 * `packages/electron/src/lib/server-lifecycle.ts`.
 * See change: consolidate-platform-handlers.
 */
export function resolveJitiFromAnchor(anchorPath: string): string | null {
  if (!existsSync(anchorPath)) return null;
  try {
    const req = createRequire(anchorPath);
    for (const jiti of JITI_PACKAGES) {
      try {
        const pkgJson = req.resolve(`${jiti}/package.json`);
        const registerPath = path.join(path.dirname(pkgJson), "lib", "jiti-register.mjs");
        if (existsSync(registerPath)) return pathToFileURL(registerPath).href;
      } catch { /* next */ }
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Test seam for `resolveJitiFromAnchor`. Pure function: given a resolver
 * and a `pathExists` predicate, walk JITI_PACKAGES and return the first
 * hit's register URL. Production wires `createRequire(anchor).resolve`
 * and `existsSync`; tests inject stubs.
 */
export function pickJitiFromAnchor(
  resolver: JitiResolver,
  pathExists: (p: string) => boolean,
): string | null {
  for (const jiti of JITI_PACKAGES) {
    try {
      const pkgJson = resolver(`${jiti}/package.json`);
      const registerPath = path.join(path.dirname(pkgJson), "lib", "jiti-register.mjs");
      if (pathExists(registerPath)) return pathToFileURL(registerPath).href;
    } catch { /* next */ }
  }
  return null;
}
