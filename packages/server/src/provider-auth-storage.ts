/**
 * Read/write ~/.pi/agent/auth.json for pi provider credentials.
 * Uses lockfile + atomic write to avoid race conditions with running pi sessions.
 *
 * The OAuth provider list derives from the local handler registry
 * (`getAllHandlers()` in provider-auth-handlers.ts). The API-key list
 * derives from the bridge-pushed catalogue (provider-catalogue-cache.ts).
 * See change: replace-hardcoded-provider-lists.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ProviderAuthStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { ProviderInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { getAllHandlers, type ProviderHandler } from "./provider-auth-handlers.js";
import { getLatestCatalogue } from "./provider-catalogue-cache.js";

// ── Constants ────────────────────────────────────────────────────────────────

const AUTH_DIR = path.join(os.homedir(), ".pi", "agent");
const AUTH_PATH = path.join(AUTH_DIR, "auth.json");
const LOCK_PATH = AUTH_PATH + ".lock";
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 50;
const LOCK_MAX_RETRIES = 40; // 40 × 50ms = 2s max wait

export type ApiKeyCredential = { type: "api_key"; key: string };
export type OAuthCredential = { type: "oauth"; refresh: string; access: string; expires: number; [k: string]: unknown };
export type AuthCredential = ApiKeyCredential | OAuthCredential;
export type AuthData = Record<string, AuthCredential>;

interface OAuthProviderMeta {
  id: string;
  name: string;
  flowType: "auth_code" | "device_code";
}

// ── Lock helpers ─────────────────────────────────────────────────────────────

function acquireLock(): void {
  // Ensure parent directory exists (fresh install may not have ~/.pi/agent/)
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
    try {
      fs.mkdirSync(LOCK_PATH, { recursive: false });
      return;
    } catch (err: any) {
      if (err.code === "EEXIST") {
        // Check for stale lock
        try {
          const stat = fs.statSync(LOCK_PATH);
          if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
            fs.rmdirSync(LOCK_PATH);
            continue;
          }
        } catch { /* stat failed, retry */ }
        // Wait and retry
        const waitMs = LOCK_RETRY_MS + Math.random() * LOCK_RETRY_MS;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed to acquire auth.json lock after retries");
}

function releaseLock(): void {
  try { fs.rmdirSync(LOCK_PATH); } catch { /* ignore */ }
}

// ── File operations ──────────────────────────────────────────────────────────

function ensureDir(): void {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

export function readAuthJson(): AuthData {
  try {
    const raw = fs.readFileSync(AUTH_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err: any) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

function writeAuthJson(data: AuthData): void {
  ensureDir();
  const tmp = AUTH_PATH + ".tmp";
  const content = JSON.stringify(data, null, 2) + "\n";

  // Preserve existing permissions or use 0600 for new file
  let mode = 0o600;
  try {
    const stat = fs.statSync(AUTH_PATH);
    mode = stat.mode & 0o777;
  } catch { /* file doesn't exist yet */ }

  fs.writeFileSync(tmp, content, { mode });
  fs.renameSync(tmp, AUTH_PATH);
}

// ── Public API: write/remove ─────────────────────────────────────────────────

export function writeCredential(provider: string, credential: AuthCredential): void {
  acquireLock();
  try {
    const data = readAuthJson();
    data[provider] = credential;
    writeAuthJson(data);
  } finally {
    releaseLock();
  }
}

export function removeCredential(provider: string): void {
  acquireLock();
  try {
    const data = readAuthJson();
    delete data[provider];
    writeAuthJson(data);
  } finally {
    releaseLock();
  }
}

// ── Pure status builder (testable) ───────────────────────────────────────────

/**
 * Pure derivation of `ProviderAuthStatus[]` from auth.json data, the
 * bridge-pushed provider catalogue, and the local OAuth handler set.
 * No I/O. See change: replace-hardcoded-provider-lists.
 */
export function _buildAuthStatus(
  catalogue: ProviderInfo[],
  authData: AuthData,
  oauthHandlers: ProviderHandler[],
): ProviderAuthStatus[] {
  const statuses: ProviderAuthStatus[] = [];
  const oauthIds = new Set(oauthHandlers.map((h) => h.providerId));

  // OAuth rows from local handler registry.
  for (const h of oauthHandlers) {
    const cred = authData[h.providerId];
    if (cred && cred.type === "oauth") {
      statuses.push({
        id: h.providerId,
        name: h.displayName,
        flowType: h.flowType,
        authenticated: true,
        expires: (cred as OAuthCredential).expires,
      });
    } else {
      statuses.push({
        id: h.providerId,
        name: h.displayName,
        flowType: h.flowType,
        authenticated: false,
      });
    }
  }

  // API-key rows from bridge-pushed catalogue.
  // Skip custom providers (registered via pi.registerProvider() from
  // ~/.pi/agent/providers.json) — those are managed by the dedicated
  // LLM Providers settings section. OAuth rows for custom providers
  // were already emitted above when the OAuth handler registry has
  // a matching id.
  for (const entry of catalogue) {
    if (entry.custom) continue;
    const hasOAuthCollision = oauthIds.has(entry.id);
    const uiId = hasOAuthCollision ? `${entry.id}-api` : entry.id;
    const displayName = hasOAuthCollision
      ? `${entry.displayName} (API Key)`
      : entry.displayName;
    const authJsonKey = entry.id;
    const cred = authData[authJsonKey];
    const hasStoredKey = !!(cred && cred.type === "api_key" && (cred as ApiKeyCredential).key);

    const row: ProviderAuthStatus = {
      id: uiId,
      name: displayName,
      flowType: "api_key",
      authenticated: hasStoredKey || !!entry.ambient,
    };
    if (hasStoredKey) {
      const key = (cred as ApiKeyCredential).key;
      row.maskedKey = key.length >= 12 ? `${key.slice(0, 5)}...${key.slice(-3)}` : "****";
    } else if (entry.ambient) {
      row.maskedKey = "(ambient)";
    }
    if (entry.envVar) row.envVar = entry.envVar;
    if (entry.ambient) row.ambient = true;
    statuses.push(row);
  }

  return statuses;
}

// ── Public API: status / OAuth meta / id resolution ─────────────────────────

export function getAuthStatus(): ProviderAuthStatus[] {
  return _buildAuthStatus(getLatestCatalogue(), readAuthJson(), getAllHandlers());
}

export function getOAuthProvidersMeta(): OAuthProviderMeta[] {
  return getAllHandlers().map((h) => ({
    id: h.providerId,
    name: h.displayName,
    flowType: h.flowType,
  }));
}

/**
 * Resolve a UI provider ID to the auth.json key.
 *
 * The catalogue encodes API-key rows with `<id>-api` suffix when an
 * OAuth handler exists for the same id. This unwraps the suffix back
 * to the underlying auth.json key. OAuth ids pass through unchanged
 * (their UI id == their auth.json key). Unknown ids pass through too,
 * matching the previous behavior.
 */
export function resolveAuthJsonKey(providerId: string): string {
  const oauthIds = new Set(getAllHandlers().map((h) => h.providerId));
  // <id>-api suffix → strip suffix iff the bare id is an OAuth handler.
  if (providerId.endsWith("-api")) {
    const bare = providerId.slice(0, -"-api".length);
    if (oauthIds.has(bare)) return bare;
  }
  return providerId;
}
