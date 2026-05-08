/**
 * Provider REST API routes: read/write custom LLM providers (~/.pi/agent/providers.json).
 */
import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { NetworkGuard } from "./route-deps.js";
import type { PiGateway } from "../pi-gateway.js";
import type { BrowserGateway } from "../browser-gateway.js";
import { probeProvider, resolveProbeApiKey, type ProbeApi } from "../provider-probe.js";

const REDACTED = "***";
const CONFIG_PATH = join(homedir(), ".pi", "agent", "providers.json");

interface ProviderEntry {
  baseUrl: string;
  apiKey: string;
  api?: string;
}

function readProvidersRaw(): Record<string, ProviderEntry> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    return raw.providers ?? {};
  } catch {
    return {};
  }
}

function redactProviders(
  providers: Record<string, ProviderEntry>,
): Record<string, ProviderEntry> {
  const redacted: Record<string, ProviderEntry> = {};
  for (const [name, entry] of Object.entries(providers)) {
    redacted[name] = {
      ...entry,
      apiKey:
        entry.apiKey && entry.apiKey.startsWith("$")
          ? entry.apiKey
          : entry.apiKey
            ? REDACTED
            : "",
    };
  }
  return redacted;
}

export function registerProviderRoutes(fastify: FastifyInstance, deps: { networkGuard: NetworkGuard; piGateway?: PiGateway; browserGateway?: BrowserGateway }): void {
  const { networkGuard, piGateway } = deps;
  fastify.get(
    "/api/providers",
    { preHandler: networkGuard },
    async () => {
      const providers = readProvidersRaw();
      return { success: true, providers: redactProviders(providers) };
    },
  );

  fastify.put(
    "/api/providers",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body as Record<string, any> | null;
      if (!body || typeof body !== "object" || !body.providers || typeof body.providers !== "object") {
        return reply.code(400).send({ success: false, error: "Invalid body" });
      }

      const incoming = body.providers as Record<string, ProviderEntry>;
      const existing = readProvidersRaw();

      // Merge: preserve redacted apiKey values from existing file
      const merged: Record<string, ProviderEntry> = {};
      for (const [name, entry] of Object.entries(incoming)) {
        merged[name] = {
          baseUrl: entry.baseUrl,
          apiKey:
            entry.apiKey === REDACTED && existing[name]
              ? existing[name].apiKey
              : entry.apiKey,
          api: entry.api,
        };
      }

      // Read raw file to preserve any non-providers fields
      let fileData: Record<string, any> = {};
      if (existsSync(CONFIG_PATH)) {
        try {
          fileData = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
        } catch {
          // start fresh
        }
      }
      fileData.providers = merged;

      const dir = dirname(CONFIG_PATH);
      mkdirSync(dir, { recursive: true });
      writeFileSync(CONFIG_PATH, JSON.stringify(fileData, null, 2) + "\n", "utf-8");

      // Broadcast credentials_updated so each bridge re-reads providers.json
      // and pushes a fresh per-session models_list. Browsers receive those
      // pushes via the existing per-session broadcast — no global wipe.
      // See change: simplify-model-selection-channels.
      if (piGateway) {
        piGateway.broadcast({ type: "credentials_updated" });
      }

      return { success: true };
    },
  );

  // Test a provider configuration without saving it. Accepts literal api keys,
  // $ENV_VAR references, or the REDACTED sentinel (***) for already-saved entries.
  fastify.post(
    "/api/providers/test",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body as Record<string, any> | null;
      if (!body || typeof body !== "object") {
        return reply.code(400).send({ ok: false, error: "Invalid body" });
      }
      const name = typeof body.name === "string" ? body.name : undefined;
      const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
      const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
      const api = typeof body.api === "string" ? (body.api as ProbeApi) : undefined;
      if (!baseUrl) {
        return reply.code(400).send({ ok: false, error: "baseUrl is required" });
      }
      if (!apiKey) {
        return reply.code(400).send({ ok: false, error: "apiKey is required" });
      }
      if (!api) {
        return reply.code(400).send({ ok: false, error: "api type is required" });
      }

      const resolved = resolveProbeApiKey({
        apiKey,
        name,
        readProviders: readProvidersRaw,
      });
      if (!resolved.ok) {
        return { ok: false, error: resolved.error };
      }

      const result = await probeProvider({
        baseUrl,
        apiKey: resolved.key,
        api,
      });
      return result;
    },
  );
}
