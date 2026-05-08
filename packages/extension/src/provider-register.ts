/**
 * Provider Extension (Dashboard)
 *
 * Registers custom LLM providers with auto-discovered models.
 * Config: ~/.pi/agent/providers.json (providers section only — preserves other fields)
 *
 * Providers are configured via the dashboard settings UI or by editing
 * ~/.pi/agent/providers.json directly. No TUI commands.
 *
 * Event API:
 *   flow:resolve-model / flow:get-available-models
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// -- Types ----------------------------------------------------------------

interface ProviderEntry {
  baseUrl: string;
  apiKey: string;
  api?: string;
}

type InputModality = "text" | "image";

export interface ModelMetadata {
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  input: InputModality[];
}

/**
 * A catalog probe: given (provider, id), return the catalog entry or null.
 * In production this is `modelRegistry.find(provider, id)` from pi's
 * ModelRegistry (which knows both built-in pi-ai models AND user-configured
 * custom models). Exposed as a parameter so unit tests can supply a fake
 * catalog without needing pi-ai installed.
 */
export type CatalogProbe = (provider: string, modelId: string) => {
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  input: readonly ("text" | "image")[];
} | null | undefined;

// -- Model metadata enrichment --------------------------------------------
//
// Custom-provider `/v1/models` endpoints return only { id, object, ... } —
// they do not advertise context_window, max_tokens, cost, or reasoning
// capability. Rather than hardcode 200k / 16k / $0 / no-reasoning for every
// discovered model (the prior behavior, which was wrong for Opus 4.6+/Sonnet
// 4.6+/GPT-5/Gemini 2.5), we consult pi's `modelRegistry.find(provider, id)`
// — which surfaces pi-ai's bundled catalog plus any custom models — for
// accurate metadata and fall back to api-appropriate defaults when the
// catalog has no match.
//
// See change: enrich-custom-provider-model-metadata.

// API type → ordered list of candidate providers in pi's catalog.
// Provider keys match pi-ai's MODELS export as surfaced by modelRegistry.
// Order matters: first match wins.
const CANDIDATE_PROVIDERS: Record<string, readonly string[]> = {
  "anthropic-messages": ["anthropic", "opencode"],
  "google-generative-ai": ["google", "google-vertex"],
  "openai-completions": ["openai", "openrouter", "groq", "xai", "mistral"],
};

// Api-typed fallback defaults when the catalog has no match. Modern floors:
//   - anthropic-messages: 200k ctx (Claude 3/4 floor), 64k maxTok
//   - google-generative-ai: 1M ctx (Gemini 1.5+/2.x floor), 65k maxTok
//   - openai-completions (default): 128k ctx (GPT-4o floor), 16k maxTok
const FALLBACK_DEFAULTS: Record<string, Omit<ModelMetadata, "input">> = {
  "anthropic-messages": {
    contextWindow: 200_000,
    maxTokens: 64_000,
    reasoning: false,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  "google-generative-ai": {
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    reasoning: false,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  "openai-completions": {
    contextWindow: 128_000,
    maxTokens: 16_384,
    reasoning: false,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
};

const DEFAULT_INPUT: InputModality[] = ["text", "image"];

/**
 * Resolve a discovered custom-provider model id to full metadata by consulting
 * pi's model catalog via the supplied `probe` function. Falls back to
 * api-appropriate defaults when no catalog entry matches OR when no probe is
 * available (e.g., modelRegistry not yet captured from spawn-context).
 *
 * Strips common proxy-prefix path segments (`cc/`, `anthropic/`,
 * `openrouter/anthropic/…`) before lookup so prefixed ids resolve to the same
 * catalog entry as the bare id.
 *
 * Exported (with the `probe` parameter) for unit testing. Production callers
 * use `registerEntry()` which injects `modelRegistry.find`.
 */
export function enrichModelMetadata(
  discoveredId: string,
  api?: string,
  probe?: CatalogProbe | null,
): ModelMetadata {
  const resolvedApi = api && api in CANDIDATE_PROVIDERS ? api : "openai-completions";
  const candidates = CANDIDATE_PROVIDERS[resolvedApi] ?? CANDIDATE_PROVIDERS["openai-completions"];

  // Build dedup'd list of ids to try: full, then everything after the last `/`.
  const lookupIds: string[] = [discoveredId];
  const lastSlash = discoveredId.lastIndexOf("/");
  if (lastSlash >= 0 && lastSlash < discoveredId.length - 1) {
    const bare = discoveredId.slice(lastSlash + 1);
    if (bare && bare !== discoveredId) lookupIds.push(bare);
  }

  if (probe) {
    for (const id of lookupIds) {
      for (const provider of candidates) {
        let match: ReturnType<CatalogProbe> | undefined;
        try {
          match = probe(provider, id);
        } catch {
          match = undefined;
        }
        if (match) {
          return {
            contextWindow: match.contextWindow,
            maxTokens: match.maxTokens,
            reasoning: match.reasoning,
            cost: match.cost,
            input: [...match.input] as InputModality[],
          };
        }
      }
    }
  }

  // No probe, or no catalog match — use api-appropriate fallback with
  // image-capable default (see change: enable-image-input-custom-providers).
  const fallback = FALLBACK_DEFAULTS[resolvedApi] ?? FALLBACK_DEFAULTS["openai-completions"];
  return {
    ...fallback,
    input: [...DEFAULT_INPUT],
  };
}

// -- Config path ----------------------------------------------------------

// Resolved lazily so HOME can be changed in tests.
function configPath(): string {
  return join(homedir(), ".pi", "agent", "providers.json");
}
const CONFIG_PATH = configPath();

// Snapshot of last-registered provider entries so reloadProviders can diff.
const lastRegistered = new Map<string, ProviderEntry>();

function entriesEqual(a: ProviderEntry, b: ProviderEntry): boolean {
  return (
    a.baseUrl === b.baseUrl &&
    a.apiKey === b.apiKey &&
    (a.api ?? "openai-completions") === (b.api ?? "openai-completions")
  );
}

// -- Config I/O (read-only — providers section) ----------------------------

function loadProviders(): Record<string, ProviderEntry> {
  const path = configPath();
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      const providers: Record<string, ProviderEntry> = { ...raw.providers };
      for (const [, entry] of Object.entries(providers) as [string, any][]) {
        if (entry.apiKeyEnv && !entry.apiKey) {
          entry.apiKey = "$" + entry.apiKeyEnv;
          delete entry.apiKeyEnv;
        }
        delete (entry as any).modelIds;
      }
      return providers;
    } catch (err: any) {
      console.error(
        `[dashboard] providers.json reload failed: ${err?.message ?? String(err)}`,
      );
    }
  }
  return {};
}

// -- API key resolution ---------------------------------------------------

function resolveApiKey(apiKey: string): string | undefined {
  if (apiKey.startsWith("$")) {
    return process.env[apiKey.slice(1)];
  }
  return apiKey;
}

function resolveApiKeyEnvName(providerName: string, apiKey: string): string {
  if (apiKey.startsWith("$")) {
    return apiKey.slice(1);
  }
  const syntheticEnv = `JUDO_${providerName.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_KEY`;
  process.env[syntheticEnv] = apiKey;
  return syntheticEnv;
}

function hasApiKey(_providerName: string, entry: ProviderEntry): boolean {
  if (entry.apiKey.startsWith("$")) {
    return !!process.env[entry.apiKey.slice(1)];
  }
  return true;
}

// -- Model discovery from /v1/models endpoint -----------------------------

interface DiscoveredModel {
  id: string;
  owned_by?: string;
}

async function discoverModels(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
  const resolved = resolveApiKey(apiKey);
  if (!resolved) return [];

  const url = baseUrl.endsWith("/") ? `${baseUrl}models` : `${baseUrl}/models`;

  try {
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${resolved}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.warn(`[provider] Model discovery failed for ${url}: HTTP ${response.status}`);
      return [];
    }

    const body = await response.json() as any;
    if (!body?.data || !Array.isArray(body.data)) {
      console.warn(`[provider] Model discovery: unexpected response format from ${url}`);
      return [];
    }

    return body.data
      .filter((m: any) => m?.id && typeof m.id === "string")
      .map((m: any) => ({ id: m.id, owned_by: m.owned_by }));
  } catch (err: any) {
    console.warn(`[provider] Model discovery failed for ${url}: ${err.message}`);
    return [];
  }
}

// -- Mutable state --------------------------------------------------------

let currentSessionProvider = "";
let currentSessionModelId = "";

let piRef: ExtensionAPI | null = null;

// Captured from any pi event handler's ctx.modelRegistry (first available wins).
// Used by getModelRegistry() to probe pi's catalog for model metadata enrichment.
// See change: enrich-custom-provider-model-metadata.
let modelRegistryRef: any = null;

// Callback for notifying the bridge when providers change
let onProvidersChanged: (() => void) | null = null;

export function getSessionInfo(): { provider: string; modelId: string } {
  return { provider: currentSessionProvider, modelId: currentSessionModelId };
}

// -- Provider catalogue (for dashboard /api/provider-auth/status) -------
//
// Pure derivation: given a captured `ModelRegistry` and the pi-ai
// helpers (`findEnvKeys`, `getEnvApiKey`), build a flat ProviderInfo[]
// covering every OAuth provider plus every distinct provider id from
// `getAll()`. The bridge pushes this to the server alongside
// `models_list`. See change: replace-hardcoded-provider-lists.

type PiAiHelpers = {
  findEnvKeys?: (id: string) => string[] | undefined;
  getEnvApiKey?: (id: string) => string | undefined;
};

export function _buildProviderCatalogue(
  modelRegistry: any,
  piAi: PiAiHelpers,
  customIds: ReadonlySet<string> = new Set(),
): ProviderInfo[] {
  if (!modelRegistry) return [];
  const oauthIds = new Set<string>(
    (modelRegistry.authStorage?.getOAuthProviders?.() ?? []).map((p: any) => p.id),
  );
  // The catalogue is the complete picture of what pi knows about —
  // built-in providers, OAuth providers, AND custom providers registered
  // by the dashboard via pi.registerProvider() from ~/.pi/agent/providers.json.
  // Custom providers carry `custom: true` so consumers can decide what
  // to surface where (e.g. the auth UI suppresses their API-key rows
  // because they're managed by the LLM Providers settings section).
  // Filtering decisions belong to consumers, not to this function.
  // See change: replace-hardcoded-provider-lists.
  const allIds = new Set<string>(oauthIds);
  for (const m of (modelRegistry.getAll?.() ?? []) as Array<{ provider?: string }>) {
    if (m.provider) allIds.add(m.provider);
  }
  return [...allIds].map((id) => {
    let displayName = id;
    try {
      displayName = modelRegistry.getProviderDisplayName?.(id) ?? id;
    } catch { /* fallback to id */ }
    let configured = false;
    let source: ProviderInfo["source"];
    try {
      const status = modelRegistry.authStorage?.getAuthStatus?.(id);
      if (status) {
        configured = !!status.configured;
        source = status.source;
      }
    } catch { /* ignore */ }
    let expires: number | undefined;
    try {
      const cred = modelRegistry.authStorage?.get?.(id);
      if (cred?.type === "oauth" && typeof cred.expires === "number") {
        expires = cred.expires;
      }
    } catch { /* ignore */ }
    let envVar: string | undefined;
    let ambient: boolean | undefined;
    try {
      const keys = piAi.findEnvKeys?.(id);
      if (keys && keys.length > 0) envVar = keys[0];
      if (piAi.getEnvApiKey?.(id) === "<authenticated>") ambient = true;
    } catch { /* ignore */ }
    return {
      id,
      displayName,
      hasOAuth: oauthIds.has(id),
      configured,
      source,
      envVar,
      ambient,
      expires,
      custom: customIds.has(id) || undefined,
    };
  });
}

// Lazy-cached pi-ai module (in scope inside pi's process).
let _piAiModule: PiAiHelpers | null = null;
let _piAiLoadAttempted = false;
async function loadPiAi(): Promise<PiAiHelpers> {
  if (_piAiModule) return _piAiModule;
  if (_piAiLoadAttempted) return {};
  _piAiLoadAttempted = true;
  try {
    const mod: any = await import("@mariozechner/pi-ai");
    _piAiModule = { findEnvKeys: mod.findEnvKeys, getEnvApiKey: mod.getEnvApiKey };
    return _piAiModule;
  } catch {
    return {};
  }
}

// Eagerly kick off pi-ai load at module import time so env-var hints
// are populated by the time the first session_register fires. Failure
// is silent; `buildProviderCatalogue` falls back to {} which still
// produces a valid catalogue minus envVar/ambient hints.
void loadPiAi();

/**
 * Public wrapper: returns the current provider catalogue, or [] when
 * the model registry has not been captured yet. Marks providers the
 * bridge itself registered (from `~/.pi/agent/providers.json` via
 * `pi.registerProvider()`) with `custom: true` so consumers can
 * suppress their API-key auth rows (those are managed by the LLM
 * Providers settings section). The catalogue itself is complete —
 * including custom providers — so other consumers (e.g. diagnostics)
 * see the full picture.
 */
export function buildProviderCatalogue(): ProviderInfo[] {
  const mr = getModelRegistry();
  if (!mr) return [];
  const piAi = _piAiModule ?? {};
  const customIds = new Set<string>(lastRegistered.keys());
  return _buildProviderCatalogue(mr, piAi, customIds);
}

export function getModelDisplayName(modelId: string): string {
  if (piRef) {
    const data: any = {};
    piRef.events.emit("flow:get-available-models", data);
    if (data.models && Array.isArray(data.models)) {
      const match = data.models.find((m: any) => m.id === modelId || `${m.provider}/${m.id}` === modelId);
      if (match?.name) return match.name;
    }
  }
  return modelId;
}

/** Register a callback for when providers change (used by bridge for models_list push). */
export function onProviderChanged(callback: () => void): void {
  onProvidersChanged = callback;
}

// -- Helper: get modelRegistry --------------------------------------------
//
// pi's ModelRegistry is passed as `ctx.modelRegistry` to every extension
// event handler (see ExtensionContext in pi's types). We capture the first
// reference we see in `session_start` and reuse it thereafter. This avoids
// depending on pi-flows' `flow:get-spawn-context` event which is not
// guaranteed to be present in every install.
function getModelRegistry(): any {
  return modelRegistryRef;
}

// -- Provider registration (with auto-discovery) --------------------------

async function registerEntry(pi: ExtensionAPI, name: string, entry: ProviderEntry): Promise<number> {
  // Record snapshot SYNCHRONOUSLY before awaiting discovery so the very
  // first providers_list push (typically fired from `session_start`
  // shortly after `activate()` kicked off async registerEntry calls) carries
  // the correct `custom: true` flags. Otherwise a slow / unreachable
  // /v1/models endpoint causes custom providers from
  // `~/.pi/agent/providers.json` to leak into Settings → Provider
  // Authentication → API Keys until the discovery probe resolves.
  // See change: fix-custom-provider-flag-race.
  lastRegistered.set(name, {
    baseUrl: entry.baseUrl,
    apiKey: entry.apiKey,
    api: entry.api ?? "openai-completions",
  });

  const discovered = await discoverModels(entry.baseUrl, entry.apiKey);

  // Metadata (contextWindow, maxTokens, reasoning, cost, input) is resolved
  // via pi's `modelRegistry.find(provider, id)` when the registry is
  // reachable, with api-appropriate fallbacks otherwise — the previous
  // hardcoded 200k / 16k / $0 / no-reasoning was silently wrong for
  // Opus 4.6+/Sonnet 4.6+/GPT-5/Gemini-2.x proxied via OpenAI-compatible
  // endpoints. See enrichModelMetadata above, and change:
  // enrich-custom-provider-model-metadata.
  const registry = getModelRegistry();
  const probe: CatalogProbe | null =
    registry && typeof registry.find === "function"
      ? (provider, modelId) => registry.find(provider, modelId) ?? null
      : null;

  const models = discovered.map((m) => ({
    id: m.id,
    name: m.id,
    ...enrichModelMetadata(m.id, entry.api, probe),
  }));

  pi.registerProvider(name, {
    baseUrl: entry.baseUrl,
    apiKey: resolveApiKeyEnvName(name, entry.apiKey),
    api: (entry.api ?? "openai-completions") as any,
    models,
  });

  // Notify bridge directly (same package — no cross-package event needed)
  onProvidersChanged?.();

  return discovered.length;
}

/**
 * Diff the current providers.json against the last-registered snapshot and
 * apply add / remove / change operations via `pi.registerProvider` and
 * `pi.unregisterProvider`. Called by the bridge's `credentials_updated`
 * handler so adding/editing/removing providers in the dashboard UI takes
 * effect without a session restart.
 *
 * Malformed providers.json or IO errors produce an empty diff and do not
 * throw, so the caller can still run `modelRegistry.refresh()` for other
 * credential updates.
 */
export async function reloadProviders(
  pi: ExtensionAPI,
): Promise<{ added: string[]; removed: string[]; changed: string[] }> {
  piRef = pi;
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  let current: Record<string, ProviderEntry>;
  try {
    current = loadProviders();
  } catch {
    return { added, removed, changed };
  }

  // Detect removals and changes against previous snapshot.
  for (const [name, prev] of lastRegistered) {
    const next = current[name];
    if (!next) {
      try {
        pi.unregisterProvider(name);
      } catch (err: any) {
        console.error(`[dashboard] unregisterProvider("${name}") failed: ${err?.message ?? String(err)}`);
      }
      lastRegistered.delete(name);
      removed.push(name);
    } else if (!entriesEqual(prev, next)) {
      try {
        pi.unregisterProvider(name);
      } catch (err: any) {
        console.error(`[dashboard] unregisterProvider("${name}") failed: ${err?.message ?? String(err)}`);
      }
      lastRegistered.delete(name);
      changed.push(name);
    }
  }

  // Register new entries and changed entries (order-dependent: unregister ran first above).
  for (const [name, entry] of Object.entries(current)) {
    if (lastRegistered.has(name)) continue;
    try {
      await registerEntry(pi, name, entry);
      if (!added.includes(name) && !changed.includes(name)) {
        added.push(name);
      }
    } catch (err: any) {
      console.error(`[dashboard] registerProvider("${name}") failed: ${err?.message ?? String(err)}`);
    }
  }

  return { added, removed, changed };
}

// -- Extension entry point ------------------------------------------------

export function activate(pi: ExtensionAPI) {
  piRef = pi;
  const providers = loadProviders();

  // Register providers (async discovery, fire-and-forget at startup)
  for (const [name, entry] of Object.entries(providers)) {
    registerEntry(pi, name, entry).catch(() => {});
  }

  // ── Event API: Model Resolution ─────────────────────────────────────

  pi.events.on("flow:resolve-model", async (data: any) => {
    const modelRef: string = data?.modelRef;
    if (!modelRef) return;

    // Role aliases (@planning etc.) are handled by pi-flows role-manager.
    if (modelRef.startsWith("@")) return;

    const registry = getModelRegistry();
    if (!registry) return;

    const parts = modelRef.split("/");
    let model: any;
    if (parts.length >= 2) {
      model = registry.find(parts[0], parts.slice(1).join("/"));
    }
    if (!model) {
      const allModels = registry.getAll?.() ?? [];
      model = allModels.find((m: any) => m.id === modelRef);
    }
    if (!model) return;

    data.model = model;
    try {
      data.auth = await registry.getApiKeyAndHeaders(model);
    } catch {
      data.auth = { ok: false, error: "Auth resolution failed" };
    }
  });

  pi.events.on("flow:get-available-models", (data: any) => {
    const registry = getModelRegistry();
    if (!registry) {
      data.models = [];
      return;
    }
    try {
      const available = registry.getAvailable?.() ?? registry.getAll?.() ?? [];
      data.models = available.map((m: any) => ({
        provider: m.provider,
        id: m.id,
        name: m.name ?? m.id,
      }));
    } catch {
      data.models = [];
    }
  });

  // ── Session lifecycle ──────────────────────────────────────────────

  pi.on("model_select", async (_event, ctx) => {
    // Also capture modelRegistry here as a belt-and-suspenders in case
    // session_start ran before activate() finished in some edge case.
    if (!modelRegistryRef && ctx.modelRegistry) {
      modelRegistryRef = ctx.modelRegistry;
    }
    if (ctx.model) {
      currentSessionProvider = ctx.model.provider ?? "";
      currentSessionModelId = ctx.model.id ?? "";
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    // Capture the modelRegistry reference the first time we see it, then
    // re-register already-registered providers so their model metadata gets
    // enriched from pi's catalog (they were registered at activate() before
    // any ctx was available, so they currently carry fallback defaults).
    // See change: enrich-custom-provider-model-metadata.
    if (!modelRegistryRef && ctx.modelRegistry) {
      modelRegistryRef = ctx.modelRegistry;
      if (lastRegistered.size > 0) {
        // Force re-registration: clear snapshot so reloadProviders re-adds all
        // entries (which will now probe the captured registry).
        const names = Array.from(lastRegistered.keys());
        lastRegistered.clear();
        for (const name of names) {
          const entry = providers[name];
          if (entry) {
            try {
              await registerEntry(pi, name, entry);
            } catch (err: any) {
              console.error(`[dashboard] re-registerProvider("${name}") failed: ${err?.message ?? String(err)}`);
            }
          }
        }

        // If the session's currently-selected model belongs to one of the
        // providers we just re-registered, re-apply it via pi.setModel() so
        // the snapshot on agent.state.model picks up the enriched metadata
        // (reasoning / contextWindow / cost). Without this, pi's session
        // still holds the pre-enrichment descriptor with reasoning: false,
        // causing setThinkingLevel to clamp to "off" even though the registry
        // now has reasoning: true. See change: enrich-custom-provider-model-metadata.
        const current = ctx.model as any;
        if (current?.provider && current?.id && names.includes(current.provider)) {
          try {
            const refreshed = ctx.modelRegistry.find(current.provider, current.id);
            if (refreshed && (pi as any).setModel) {
              await (pi as any).setModel(refreshed);
            }
          } catch (err: any) {
            console.error(`[dashboard] re-setModel after enrichment failed: ${err?.message ?? String(err)}`);
          }
        }
      }
    }

    if (ctx.model) {
      currentSessionProvider = ctx.model.provider ?? "";
      currentSessionModelId = ctx.model.id ?? "";
    }

    // Warn about providers missing API keys
    for (const [name, entry] of Object.entries(providers)) {
      if (!hasApiKey(name, entry)) {
        const hint = entry.apiKey.startsWith("$")
          ? `Set ${entry.apiKey}`
          : "Check API key";
        ctx.ui.notify(
          `${name}: ${hint} or add "${name}" to ~/.pi/agent/auth.json`,
          "warning",
        );
      }
    }
  });
}
