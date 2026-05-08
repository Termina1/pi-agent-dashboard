/**
 * Tests for the provider-register hot-reload path.
 *
 * `reloadProviders(pi)` diffs the current providers.json against a
 * last-registered snapshot and calls pi.registerProvider / pi.unregisterProvider
 * as needed. Async model discovery is stubbed via a fetch mock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We re-import the module fresh in each test so module-level `lastRegistered`
// state starts empty.
async function importFresh() {
  vi.resetModules();
  return (await import("../provider-register.js")) as typeof import("../provider-register.js");
}

function makeMockPi() {
  const registerProvider = vi.fn();
  const unregisterProvider = vi.fn();
  const pi = {
    registerProvider,
    unregisterProvider,
    events: { on: vi.fn(), emit: vi.fn() },
    on: vi.fn(),
  } as any;
  return { pi, registerProvider, unregisterProvider };
}

function writeProvidersJson(home: string, providers: Record<string, any>) {
  const dir = join(home, ".pi", "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "providers.json"),
    JSON.stringify({ providers }, null, 2),
    "utf-8",
  );
}

describe("reloadProviders", () => {
  let tmpHome: string;
  const originalHome = process.env.HOME;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "provider-reload-"));
    process.env.HOME = tmpHome;
    // Stub fetch to return 2 models so discovery succeeds cheaply
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }), { status: 200 }),
    ) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("adds a new provider when providers.json gains an entry (snapshot was empty)", async () => {
    const mod = await importFresh();
    const { pi, registerProvider, unregisterProvider } = makeMockPi();

    writeProvidersJson(tmpHome, {
      "my-llm": {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-abc",
        api: "openai-completions",
      },
    });

    const diff = await mod.reloadProviders(pi);
    expect(diff.added).toEqual(["my-llm"]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(registerProvider).toHaveBeenCalledTimes(1);
    expect(registerProvider).toHaveBeenCalledWith("my-llm", expect.objectContaining({
      baseUrl: "https://api.example.com/v1",
      api: "openai-completions",
    }));
    expect(unregisterProvider).not.toHaveBeenCalled();
  });

  it("removes a provider when its entry disappears from providers.json", async () => {
    const mod = await importFresh();
    const { pi, registerProvider, unregisterProvider } = makeMockPi();

    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://x", apiKey: "k", api: "openai-completions" },
    });
    await mod.reloadProviders(pi);
    expect(registerProvider).toHaveBeenCalledTimes(1);

    writeProvidersJson(tmpHome, {});
    const diff = await mod.reloadProviders(pi);

    expect(diff.removed).toEqual(["my-llm"]);
    expect(diff.added).toEqual([]);
    expect(unregisterProvider).toHaveBeenCalledTimes(1);
    expect(unregisterProvider).toHaveBeenCalledWith("my-llm");
  });

  it("re-registers (unregister then register) when baseUrl changes", async () => {
    const mod = await importFresh();
    const { pi, registerProvider, unregisterProvider } = makeMockPi();

    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://old.example.com/v1", apiKey: "k", api: "openai-completions" },
    });
    await mod.reloadProviders(pi);
    expect(registerProvider).toHaveBeenCalledTimes(1);

    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://new.example.com/v1", apiKey: "k", api: "openai-completions" },
    });
    const diff = await mod.reloadProviders(pi);

    expect(diff.changed).toEqual(["my-llm"]);
    // unregister must be called before the second register
    const unregOrder = unregisterProvider.mock.invocationCallOrder[0];
    const reg2Order = registerProvider.mock.invocationCallOrder[1];
    expect(unregOrder).toBeLessThan(reg2Order);
    expect(registerProvider).toHaveBeenLastCalledWith(
      "my-llm",
      expect.objectContaining({ baseUrl: "https://new.example.com/v1" }),
    );
  });

  it("unchanged providers.json produces no register/unregister calls on second reload", async () => {
    const mod = await importFresh();
    const { pi, registerProvider, unregisterProvider } = makeMockPi();

    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://x", apiKey: "k", api: "openai-completions" },
    });
    await mod.reloadProviders(pi);
    registerProvider.mockClear();
    unregisterProvider.mockClear();

    const diff = await mod.reloadProviders(pi);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(registerProvider).not.toHaveBeenCalled();
    expect(unregisterProvider).not.toHaveBeenCalled();
  });

  it("malformed providers.json returns empty diff and does not throw", async () => {
    const mod = await importFresh();
    const { pi } = makeMockPi();

    const dir = join(tmpHome, ".pi", "agent");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "providers.json"), "not valid json {", "utf-8");

    await expect(mod.reloadProviders(pi)).resolves.toEqual({
      added: [],
      removed: [],
      changed: [],
    });
  });

  it("treats apiKey change as 'changed'", async () => {
    const mod = await importFresh();
    const { pi, registerProvider, unregisterProvider } = makeMockPi();

    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://x", apiKey: "old", api: "openai-completions" },
    });
    await mod.reloadProviders(pi);

    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://x", apiKey: "new", api: "openai-completions" },
    });
    const diff = await mod.reloadProviders(pi);
    expect(diff.changed).toEqual(["my-llm"]);
    expect(unregisterProvider).toHaveBeenCalledWith("my-llm");
  });

  it("treats api type change as 'changed'", async () => {
    const mod = await importFresh();
    const { pi } = makeMockPi();

    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://x", apiKey: "k", api: "openai-completions" },
    });
    await mod.reloadProviders(pi);

    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://x", apiKey: "k", api: "openai-responses" },
    });
    const diff = await mod.reloadProviders(pi);
    expect(diff.changed).toEqual(["my-llm"]);
  });

  // ── input capability default (see change: enable-image-input-custom-providers) ─────
  // Every discovered model must advertise `input: ["text", "image"]` so pi-ai does
  // not strip pasted images via `downgradeUnsupportedImages` before the request
  // leaves the bridge. This guards both the initial-registration path and the
  // reloadProviders() re-register path.

  it("discovered models default to input: [\"text\", \"image\"] on fresh register", async () => {
    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();

    writeProvidersJson(tmpHome, {
      "my-llm": {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-abc",
        api: "openai-completions",
      },
    });

    await mod.reloadProviders(pi);

    expect(registerProvider).toHaveBeenCalledTimes(1);
    const [, config] = registerProvider.mock.calls[0];
    expect(Array.isArray(config.models)).toBe(true);
    expect(config.models.length).toBe(2); // two models from the fetch stub
    for (const m of config.models) {
      expect(m.input).toEqual(["text", "image"]);
    }
  });

  it("re-registered models (after reload diff) retain input: [\"text\", \"image\"]", async () => {
    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();

    // Initial register
    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://old.example.com/v1", apiKey: "k", api: "openai-completions" },
    });
    await mod.reloadProviders(pi);

    // Change baseUrl → triggers unregister + re-register
    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://new.example.com/v1", apiKey: "k", api: "openai-completions" },
    });
    const diff = await mod.reloadProviders(pi);
    expect(diff.changed).toEqual(["my-llm"]);

    // Second registerProvider call is the re-register; must carry same input default
    expect(registerProvider).toHaveBeenCalledTimes(2);
    const [, secondConfig] = registerProvider.mock.calls[1];
    for (const m of secondConfig.models) {
      expect(m.input).toEqual(["text", "image"]);
    }
  });

  // ── model metadata enrichment (see change: enrich-custom-provider-model-metadata) ──
  // registerEntry() resolves per-model metadata via enrichModelMetadata() which
  // consults pi-ai's bundled catalog. These tests verify the end-to-end path:
  // discovered id → catalog match → registerProvider receives accurate fields.

  it("captures ctx.modelRegistry from session_start and re-registers providers with enriched metadata", async () => {
    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();

    // Capture the session_start handler registered by activate().
    const handlers = new Map<string, (event: any, ctx: any) => Promise<void> | void>();
    pi.on = vi.fn((event: string, handler: any) => {
      handlers.set(event, handler);
    });

    // Fake pi's ModelRegistry. `find(provider, id)` returns Opus 4.7's real
    // metadata for the anthropic entry, simulating what pi passes via
    // ctx.modelRegistry at session_start.
    const fakeRegistry = {
      find: vi.fn((provider: string, id: string) => {
        if (provider === "anthropic" && id === "claude-opus-4-7") {
          return {
            contextWindow: 1_000_000,
            maxTokens: 128_000,
            reasoning: true,
            cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
            input: ["text", "image"],
          };
        }
        return null;
      }),
    };

    // Fetch mock advertises the real model id.
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: [{ id: "cc/claude-opus-4-7" }] }),
        { status: 200 },
      ),
    ) as any;

    writeProvidersJson(tmpHome, {
      proxy: {
        baseUrl: "https://llmproxy.example.com/v1",
        apiKey: "sk-test",
        api: "anthropic-messages",
      },
    });

    // 1) activate() registers the provider BEFORE ctx.modelRegistry is
    //    available — first registration hits the fallback path.
    mod.activate(pi);
    // Wait a microtask for the fire-and-forget registerEntry inside activate.
    await new Promise((r) => setTimeout(r, 10));

    expect(registerProvider).toHaveBeenCalledTimes(1);
    const firstCall = registerProvider.mock.calls[0];
    expect(firstCall[1].models[0].contextWindow).toBe(200_000); // fallback

    // 2) Fire session_start with ctx.modelRegistry — the handler captures it
    //    and re-registers all known providers with the enriched metadata.
    const sessionStartHandler = handlers.get("session_start");
    expect(sessionStartHandler).toBeDefined();
    await sessionStartHandler!({ type: "session_start" }, {
      ui: { notify: vi.fn() },
      modelRegistry: fakeRegistry,
      model: undefined,
    });

    // 3) The re-registration should have issued a second registerProvider
    //    call, this time with the catalog-enriched metadata.
    expect(registerProvider).toHaveBeenCalledTimes(2);
    const secondCall = registerProvider.mock.calls[1];
    const [name, config] = secondCall;
    expect(name).toBe("proxy");
    const [opus] = config.models;
    expect(opus.id).toBe("cc/claude-opus-4-7");
    expect(opus.contextWindow).toBe(1_000_000);
    expect(opus.maxTokens).toBe(128_000);
    expect(opus.reasoning).toBe(true);
    expect(opus.cost.input).toBe(5);
    expect(opus.cost.output).toBe(25);
    // Probed with prefix-stripped bare id under `anthropic`.
    expect(fakeRegistry.find).toHaveBeenCalledWith("anthropic", "claude-opus-4-7");
  });

  it("without modelRegistry (never captured), discovered models fall back to api-appropriate defaults", async () => {
    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();

    // No session_start fires — modelRegistryRef stays null and the probe is
    // null, so every discovered id hits the fallback table.
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: [{ id: "cc/claude-opus-4-7" }] }),
        { status: 200 },
      ),
    ) as any;

    writeProvidersJson(tmpHome, {
      proxy: {
        baseUrl: "https://llmproxy.example.com/v1",
        apiKey: "sk-test",
        api: "anthropic-messages",
      },
    });

    await mod.reloadProviders(pi);

    const [, config] = registerProvider.mock.calls[0];
    const [opus] = config.models;
    // anthropic-messages fallback: 200k / 64k / no reasoning / zero cost / text+image.
    expect(opus.contextWindow).toBe(200_000);
    expect(opus.maxTokens).toBe(64_000);
    expect(opus.reasoning).toBe(false);
    expect(opus.input).toEqual(["text", "image"]);
  });

  // ── custom-flag race regression (see change: fix-custom-provider-flag-race) ──
  // The bridge's first `providers_list` push fires from `session_start`
  // shortly after `activate()` kicked off async `registerEntry()` calls.
  // The catalogue's `custom: true` flag MUST be set on that first push,
  // even when each provider's `/v1/models` endpoint hasn't responded yet —
  // otherwise custom providers from `~/.pi/agent/providers.json` leak into
  // Settings → Provider Authentication → API Keys (where they don't belong;
  // the LLM Providers section already manages them).

  it("custom flag is set on first providers_list push, before discoverModels resolves (regression)", async () => {
    const mod = await importFresh();
    const { pi } = makeMockPi();

    // Capture event handlers so we can fire model_select to set modelRegistryRef.
    const handlers = new Map<string, (event: any, ctx: any) => Promise<void> | void>();
    pi.on = vi.fn((event: string, handler: any) => { handlers.set(event, handler); });

    // Stub fetch with a never-resolving promise — simulates a slow or
    // unreachable /v1/models endpoint. The fix's correctness does NOT depend
    // on this resolving; the synchronous `lastRegistered.set` runs before the
    // await.
    let resolveFetch: ((value: Response) => void) | null = null;
    globalThis.fetch = vi.fn(
      () => new Promise<Response>((r) => { resolveFetch = r; }),
    ) as any;

    // Two custom providers. With the fix, both end up in lastRegistered
    // synchronously when activate() iterates them.
    writeProvidersJson(tmpHome, {
      proxy: { baseUrl: "https://example.com/v1", apiKey: "sk-test", api: "openai-completions" },
      "your-llmproxy": { baseUrl: "https://example2.com/v1", apiKey: "sk-test", api: "openai-completions" },
    });

    // activate() fires registerEntry async (.catch(() => {})). The synchronous
    // body runs to the first await before yielding.
    mod.activate(pi);

    // Capture modelRegistry via a model_select event — buildProviderCatalogue()
    // returns [] when modelRegistryRef is null. We use model_select rather
    // than session_start because session_start would re-register every entry
    // (also stalling on the never-resolving fetch).
    const fakeRegistry = {
      find: () => null,
      getAll: () => [
        { provider: "proxy", id: "some-model" },
        { provider: "your-llmproxy", id: "some-model" },
        { provider: "deepseek", id: "deepseek-chat" },
      ],
      getProviderDisplayName: (id: string) => id,
      authStorage: {
        getOAuthProviders: () => [],
        getAuthStatus: () => ({ configured: false }),
        get: () => undefined,
      },
    };
    const modelSelectHandler = handlers.get("model_select");
    expect(modelSelectHandler).toBeDefined();
    await modelSelectHandler!({}, { modelRegistry: fakeRegistry, model: undefined });

    // Build the catalogue while discovery is still in flight. With the fix,
    // both custom providers are flagged custom: true. Without it, lastRegistered
    // is still empty (the post-await `lastRegistered.set` never runs because
    // fetch never resolves) and the flags are missing.
    const cat = mod.buildProviderCatalogue();

    expect(cat.find((c) => c.id === "proxy")?.custom).toBe(true);
    expect(cat.find((c) => c.id === "your-llmproxy")?.custom).toBe(true);
    // Built-in pi-ai providers must remain unflagged.
    expect(cat.find((c) => c.id === "deepseek")?.custom).toBeUndefined();

    // Cleanup: settle the dangling fetches so the test process doesn't leak.
    if (resolveFetch) resolveFetch(new Response(JSON.stringify({ data: [] }), { status: 200 }));
  });

  it("discovered unknown model falls back to api-appropriate defaults (openai-completions → 128k)", async () => {
    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();

    // Default beforeEach fetch stub returns `m1` and `m2` — neither exists in catalog.
    writeProvidersJson(tmpHome, {
      "my-llm": {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-abc",
        api: "openai-completions",
      },
    });

    await mod.reloadProviders(pi);

    const [, config] = registerProvider.mock.calls[0];
    for (const m of config.models) {
      expect(m.contextWindow).toBe(128_000);
      expect(m.maxTokens).toBe(16_384);
      expect(m.reasoning).toBe(false);
      expect(m.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      expect(m.input).toEqual(["text", "image"]);
    }
  });
});
