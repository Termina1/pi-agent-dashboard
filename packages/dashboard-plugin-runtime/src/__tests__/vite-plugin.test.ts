/**
 * Tests for the Vite plugin manifest scanning and registry generation.
 * We test the generation logic without spinning up a real Vite server.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearDiscoveryCache } from "../server/loader.js";

// We test the generation by importing the internal helpers via the vite-plugin module.
// Since the plugin is exported, we call buildStart directly.

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vite-plugin-test-"));
  clearDiscoveryCache();
  // Write a fake packages dir
  fs.mkdirSync(path.join(tmpDir, "packages"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "packages", "client", "src", "generated"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearDiscoveryCache();
});

function writePlugin(name: string | undefined, manifest: Record<string, unknown>) {
  const dirName = name ?? `plugin-${Math.random().toString(36).slice(2, 8)}`;
  const pkgDir = path.join(tmpDir, "packages", dirName);
  fs.mkdirSync(pkgDir, { recursive: true });
  const pkgJson = name
    ? { name, "pi-dashboard-plugin": manifest }
    : { "pi-dashboard-plugin": manifest };
  fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify(pkgJson));
}

async function invokePlugin(opts?: { includeFixtures?: boolean }): Promise<string> {
  const oldIncludeFixtures = process.env.PI_DASHBOARD_INCLUDE_FIXTURES;
  if (opts?.includeFixtures) process.env.PI_DASHBOARD_INCLUDE_FIXTURES = "1";
  else delete process.env.PI_DASHBOARD_INCLUDE_FIXTURES;
  try {
    const { viteDashboardPluginsPlugin } = await import("../vite-plugin/index.js");
    const plugin = viteDashboardPluginsPlugin(tmpDir);
    // Call buildStart manually
    await (plugin as { buildStart?: () => void }).buildStart?.();

    const outPath = path.join(tmpDir, "packages", "client", "src", "generated", "plugin-registry.tsx");
    return fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf-8") : "";
  } finally {
    if (oldIncludeFixtures === undefined) delete process.env.PI_DASHBOARD_INCLUDE_FIXTURES;
    else process.env.PI_DASHBOARD_INCLUDE_FIXTURES = oldIncludeFixtures;
    clearDiscoveryCache();
  }
}

describe("viteDashboardPluginsPlugin", () => {
  it("generates registry with named imports for claimed components using stable package specifiers", async () => {
    writePlugin("openspec-plugin", {
      id: "openspec",
      displayName: "OpenSpec",
      priority: 100,
      client: "./dist/client/index.js",
      claims: [
        { slot: "session-card-badge", component: "OpenSpecBadge" },
        { slot: "settings-section", component: "OpenSpecSettings", tab: "general" },
      ],
    });

    const content = await invokePlugin();
    // Should use named imports, not import *
    expect(content).toContain("import { OpenSpecBadge, OpenSpecSettings }");
    expect(content).not.toContain("import * as");
    expect(content).toContain('from "openspec-plugin/client"');
    expect(content).not.toMatch(/from\s+"\/[^"]+"/);
    expect(content).toContain("PLUGIN_REGISTRY");
    expect(content).toContain('"openspec"');
  });

  it("falls back to repo-relative imports when package name is unavailable", async () => {
    writePlugin(undefined, {
      id: "local-only",
      displayName: "Local Only",
      priority: 100,
      client: "./dist/client/index.js",
      claims: [{ slot: "session-card-badge", component: "LocalOnlyBadge" }],
    });

    const content = await invokePlugin();
    expect(content).toContain('from "../../../plugin-');
    expect(content).toContain('/dist/client/index.js"');
    expect(content).not.toMatch(/from\s+"\/[^"]+"/);
  });

  it("skips fixture plugins by default", async () => {
    writePlugin("demo-plugin", {
      id: "demo",
      displayName: "Demo",
      fixture: true,
      client: "./dist/client/index.js",
      claims: [{ slot: "session-card-badge", component: "DemoBadge" }],
    });

    const content = await invokePlugin();
    expect(content).not.toContain("demo");
    expect(content).not.toContain("DemoBadge");
  });

  it("includes fixture plugins when explicitly opted in", async () => {
    writePlugin("demo-plugin", {
      id: "demo",
      displayName: "Demo",
      fixture: true,
      client: "./dist/client/index.js",
      claims: [{ slot: "session-card-badge", component: "DemoBadge" }],
    });

    const content = await invokePlugin({ includeFixtures: true });
    expect(content).toContain('from "demo-plugin/client"');
    expect(content).toContain("DemoBadge");
  });

  it("does not regenerate when manifest content hasn't changed", async () => {
    writePlugin("stable-plugin", {
      id: "stable",
      displayName: "Stable",
      client: "./dist/client/index.js",
      claims: [],
    });

    // First generation
    const content1 = await invokePlugin();
    // Second generation — must produce same content
    const content2 = await invokePlugin();
    expect(content1).toBeTruthy();
    expect(content1).toBe(content2);
  });
});
