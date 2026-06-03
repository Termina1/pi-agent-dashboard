import { describe, expect, it } from "vitest";
import {
  buildDashboardExtensionArgsFromResources,
  isDashboardBlockedExtensionResource,
  type DashboardExtensionResource,
} from "../dashboard-extension-filter.js";

function resource(
  extensionPath: string,
  source: string,
  options: Partial<DashboardExtensionResource> = {},
): DashboardExtensionResource {
  return {
    path: extensionPath,
    enabled: true,
    metadata: {
      source,
      scope: "user",
      origin: "package",
      baseDir: `/tmp/${source.replace(/[^a-z0-9-]/gi, "-")}`,
    },
    ...options,
  };
}

describe("dashboard extension filter", () => {
  it("detects the pi-diffloop npm package by source", () => {
    expect(isDashboardBlockedExtensionResource(resource("/pkg/src/diffloop.ts", "npm:@lpirito/pi-diffloop"))).toBe(true);
    expect(isDashboardBlockedExtensionResource(resource("/pkg/src/diffloop.ts", "npm:@lpirito/pi-diffloop@0.0.30"))).toBe(true);
  });

  it("does not block unrelated extension packages", () => {
    expect(isDashboardBlockedExtensionResource(resource("/pkg/src/index.ts", "npm:pi-subagents"))).toBe(false);
    expect(isDashboardBlockedExtensionResource(resource("/pkg/src/bridge.ts", "npm:@blackbelt-technology/pi-agent-dashboard"))).toBe(false);
  });

  it("builds --no-extensions plus explicit extension paths only when pi-diffloop is present", () => {
    const args = buildDashboardExtensionArgsFromResources([
      resource("/extensions/dashboard/bridge.ts", "npm:@blackbelt-technology/pi-agent-dashboard"),
      resource("/extensions/subagents/index.ts", "npm:pi-subagents"),
      resource("/extensions/diffloop/diffloop.ts", "npm:@lpirito/pi-diffloop"),
    ]);

    expect(args).toEqual([
      "--no-extensions",
      "--extension",
      "/extensions/dashboard/bridge.ts",
      "--extension",
      "/extensions/subagents/index.ts",
    ]);
  });

  it("omits disabled extensions from the explicit allowlist", () => {
    const args = buildDashboardExtensionArgsFromResources([
      resource("/extensions/dashboard/bridge.ts", "npm:@blackbelt-technology/pi-agent-dashboard"),
      resource("/extensions/disabled/index.ts", "npm:disabled-extension", { enabled: false }),
      resource("/extensions/diffloop/diffloop.ts", "npm:@lpirito/pi-diffloop"),
    ]);

    expect(args).toEqual([
      "--no-extensions",
      "--extension",
      "/extensions/dashboard/bridge.ts",
    ]);
  });

  it("returns no args when there is no blocked extension", () => {
    expect(buildDashboardExtensionArgsFromResources([
      resource("/extensions/dashboard/bridge.ts", "npm:@blackbelt-technology/pi-agent-dashboard"),
      resource("/extensions/subagents/index.ts", "npm:pi-subagents"),
    ])).toEqual([]);
  });
});
