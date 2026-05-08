/**
 * Plugin loader: discovers manifests and loads server entries.
 *
 * Discovery globs packages/* /package.json (without space) once per process.
 * Both the Vite plugin and loadServerEntries share the discovery result
 * via a module-level cache.
 */
import fs from "node:fs";
import path from "node:path";
import { validateManifest, ManifestValidationError } from "../manifest-validator.js";
import type { PluginManifest } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import type { ServerPluginContext } from "./server-context.js";
import { createPluginStatusStore, type PluginStatusStore } from "./plugin-status-store.js";

// ── Discovery cache ────────────────────────────────────────────────────────

export interface DiscoveredPlugin {
  manifest: PluginManifest;
  packageDir: string;
  /** npm package name from package.json (used for stable client import specifiers). */
  packageName?: string;
  /** Absolute path to the server entry (if declared and resolved). */
  serverEntryPath?: string;
  /** Absolute path to the bridge entry (if declared and resolved). */
  bridgeEntryPath?: string;
  /** Absolute path to the client entry (if declared and resolved). */
  clientEntryPath?: string;
}

let _discoveryCache: DiscoveredPlugin[] | null = null;

/**
 * Glob packages/[star]/package.json for pi-dashboard-plugin manifests.
 * Results are cached for the process lifetime.
 * Pass `repoRoot` (default: cwd when the module loaded) for the scan.
 */
export function discoverPlugins(repoRoot?: string): DiscoveredPlugin[] {
  if (_discoveryCache !== null) return _discoveryCache;

  const root = repoRoot ?? process.cwd();
  const packagesDir = path.join(root, "packages");

  if (!fs.existsSync(packagesDir)) {
    _discoveryCache = [];
    return _discoveryCache;
  }

  const results: DiscoveredPlugin[] = [];

  let entries: string[];
  try {
    entries = fs.readdirSync(packagesDir);
  } catch {
    _discoveryCache = [];
    return _discoveryCache;
  }

  for (const entry of entries) {
    const pkgDir = path.join(packagesDir, entry);
    const pkgJson = path.join(pkgDir, "package.json");
    if (!fs.existsSync(pkgJson)) continue;

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(fs.readFileSync(pkgJson, "utf-8"));
    } catch {
      continue;
    }

    // Check for adjacent dashboard-plugin.json (takes precedence)
    const adjacentJson = path.join(pkgDir, "dashboard-plugin.json");
    let manifestRaw: unknown = raw["pi-dashboard-plugin"];

    if (fs.existsSync(adjacentJson)) {
      if (manifestRaw !== undefined) {
        console.warn(
          `[plugin-loader] Both package.json#pi-dashboard-plugin and dashboard-plugin.json found in ${pkgDir}. Using dashboard-plugin.json.`,
        );
      }
      try {
        manifestRaw = JSON.parse(fs.readFileSync(adjacentJson, "utf-8"));
      } catch {
        continue;
      }
    }

    if (manifestRaw === undefined || manifestRaw === null) continue;

    let manifest: PluginManifest;
    try {
      manifest = validateManifest(manifestRaw);
    } catch (e) {
      console.error(`[plugin-loader] Validation failed for package at ${pkgDir}:`, e);
      continue;
    }

    const resolve = (rel: string | undefined) =>
      rel ? path.resolve(pkgDir, rel) : undefined;

    results.push({
      manifest,
      packageDir: pkgDir,
      packageName: typeof raw.name === "string" ? raw.name : undefined,
      serverEntryPath: resolve(manifest.server),
      bridgeEntryPath: resolve(manifest.bridge),
      clientEntryPath: resolve(manifest.client),
    });
  }

  // Sort by (priority asc, id asc)
  results.sort((a, b) => {
    const pa = a.manifest.priority ?? 1000;
    const pb = b.manifest.priority ?? 1000;
    if (pa !== pb) return pa - pb;
    return a.manifest.id.localeCompare(b.manifest.id);
  });

  _discoveryCache = results;
  return results;
}

/** Clear the discovery cache (for testing). */
export function clearDiscoveryCache(): void {
  _discoveryCache = null;
}

// ── Status store singleton ─────────────────────────────────────────────────

let _statusStore: PluginStatusStore | null = null;

export function getPluginStatusStore(): PluginStatusStore {
  if (!_statusStore) _statusStore = createPluginStatusStore();
  return _statusStore;
}

/** Reset the status store (for testing). */
export function clearStatusStore(): void {
  _statusStore = null;
}

// ── Server-side loader ─────────────────────────────────────────────────────

export interface ServerLoadDeps {
  /** Factory that creates a ServerPluginContext for a specific plugin. */
  createContext: (plugin: DiscoveredPlugin) => ServerPluginContext;
  /** Config accessor: is this plugin enabled? */
  isEnabled: (pluginId: string) => boolean;
  /** Repo root for discovery (defaults to cwd). */
  repoRoot?: string;
}

/**
 * Discover plugins and load each enabled plugin's server entry.
 * Awaits each plugin's registerPlugin() before proceeding.
 * Plugin failures are caught, logged, and reflected in the status store.
 */
export async function loadServerEntries(deps: ServerLoadDeps): Promise<void> {
  const store = getPluginStatusStore();
  const plugins = discoverPlugins(deps.repoRoot);

  for (const plugin of plugins) {
    const { manifest } = plugin;
    const enabled = deps.isEnabled(manifest.id);

    if (!enabled) {
      store.setStatus({
        id: manifest.id,
        enabled: false,
        loaded: false,
        claims: manifest.claims.length,
      });
      continue;
    }

    if (!plugin.serverEntryPath) {
      // No server entry — still mark as loaded (client-only plugin)
      store.setStatus({
        id: manifest.id,
        enabled: true,
        loaded: true,
        claims: manifest.claims.length,
      });
      continue;
    }

    const ctx = deps.createContext(plugin);
    try {
      const mod = await import(plugin.serverEntryPath);
      if (typeof mod.default !== "function") {
        throw new Error(`Server entry at ${plugin.serverEntryPath} has no default export function`);
      }
      await mod.default(ctx);
      store.setStatus({
        id: manifest.id,
        enabled: true,
        loaded: true,
        claims: manifest.claims.length,
      });
      console.info(`[plugin-loader] Loaded plugin "${manifest.id}"`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      store.setStatus({
        id: manifest.id,
        enabled: true,
        loaded: false,
        error: msg,
        claims: manifest.claims.length,
      });
      console.error(`[plugin-loader] Failed to load plugin "${manifest.id}": ${msg}`);
    }
  }
}
