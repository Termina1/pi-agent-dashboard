/**
 * Resolves the appropriate TypeScript loader for spawning the dashboard server.
 *
 * - Standalone mode: tsx from ~/.pi-dashboard/node_modules/
 * - Power user mode: jiti from pi's install, falling back to tsx
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { MANAGED_DIR } from "./managed-paths.js";

export type InstallMode = "standalone" | "power-user";

/**
 * Resolve the `--import` loader path for `node --import <loader> server/cli.ts`.
 * Returns the absolute path to the ESM register hook.
 */
export function resolveTsLoader(mode: InstallMode): string {
  if (mode === "power-user") {
    // Try jiti from pi's install first
    const jitiPath = resolveJitiFromPi();
    if (jitiPath) return jitiPath;
  }

  // Standalone mode, or jiti not found — use tsx
  const tsxPath = resolveTsx();
  if (tsxPath) return tsxPath;

  throw new Error(
    "Cannot find TypeScript loader. " +
    (mode === "standalone"
      ? "Run the standalone installer to install tsx."
      : "Ensure pi or tsx is installed.")
  );
}

/** Resolve jiti register hook from pi's globally or locally installed jiti. */
function resolveJitiFromPi(): string | null {
  // Try resolving from pi's known install locations
  const candidates = [
    // Global npm
    tryResolveJiti("@earendil-works/pi-coding-agent"),
    tryResolveJiti("@mariozechner/pi-coding-agent"),
    tryResolveJiti("@oh-my-pi/pi-coding-agent"),
    // Managed install
    tryResolveJitiFrom(path.join(MANAGED_DIR, "node_modules", "@earendil-works", "pi-coding-agent", "package.json")),
    tryResolveJitiFrom(path.join(MANAGED_DIR, "node_modules", "@mariozechner", "pi-coding-agent", "package.json")),
    tryResolveJitiFrom(path.join(MANAGED_DIR, "node_modules", "@oh-my-pi", "pi-coding-agent", "package.json")),
  ];

  for (const c of candidates) {
    if (c) return c;
  }
  return null;
}

function tryResolveJiti(piPkgName: string): string | null {
  try {
    const req = createRequire(require.resolve(`${piPkgName}/package.json`));
    for (const jitiPkg of ["jiti", "@mariozechner/jiti", "@oh-my-pi/jiti"]) {
      try {
        const pkgJson = req.resolve(`${jitiPkg}/package.json`);
        const registerPath = path.join(path.dirname(pkgJson), "lib", "jiti-register.mjs");
        if (existsSync(registerPath)) return registerPath;
      } catch { /* next */ }
    }
  } catch { /* not installed */ }
  return null;
}

function tryResolveJitiFrom(piPkgJsonPath: string): string | null {
  if (!existsSync(piPkgJsonPath)) return null;
  try {
    const req = createRequire(piPkgJsonPath);
    for (const jitiPkg of ["jiti", "@mariozechner/jiti", "@oh-my-pi/jiti"]) {
      try {
        const pkgJson = req.resolve(`${jitiPkg}/package.json`);
        const registerPath = path.join(path.dirname(pkgJson), "lib", "jiti-register.mjs");
        if (existsSync(registerPath)) return registerPath;
      } catch { /* next */ }
    }
  } catch { /* ignore */ }
  return null;
}

/** Resolve tsx ESM loader from managed install or global. */
function resolveTsx(): string | null {
  // Prefer the CJS register hook — it shims __dirname/__filename
  // which the ESM-only loader does not.
  const cjsCandidates = [
    path.join(MANAGED_DIR, "node_modules", "tsx", "dist", "register.js"),
    path.join(MANAGED_DIR, "node_modules", "tsx", "dist", "cjs", "index.js"),
  ];
  for (const p of cjsCandidates) {
    if (existsSync(p)) return p;
  }

  // Fallback to ESM loader
  const managedEsm = path.join(MANAGED_DIR, "node_modules", "tsx", "dist", "esm", "index.mjs");
  if (existsSync(managedEsm)) return managedEsm;

  // Global
  try {
    const tsxMain = require.resolve("tsx");
    const tsxDir = path.dirname(tsxMain);
    // Try CJS register first
    const cjsPath = path.join(tsxDir, "register.js");
    if (existsSync(cjsPath)) return cjsPath;
    // Then ESM
    const esmPath = path.join(tsxDir, "esm", "index.mjs");
    if (existsSync(esmPath)) return esmPath;
  } catch { /* not installed globally */ }

  return null;
}
