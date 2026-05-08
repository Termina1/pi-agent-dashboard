/**
 * Tests for CLI argument parsing.
 */
import { describe, it, expect } from "vitest";
import { parseArgs } from "../cli.js";

describe("parseArgs", () => {
  it("returns null subcommand with no args", () => {
    const result = parseArgs([]);
    expect(result.subcommand).toBeNull();
    expect(result.flags).toEqual({});
  });

  it("parses start subcommand", () => {
    const result = parseArgs(["start"]);
    expect(result.subcommand).toBe("start");
  });

  it("parses stop subcommand", () => {
    const result = parseArgs(["stop"]);
    expect(result.subcommand).toBe("stop");
  });

  it("parses restart subcommand", () => {
    const result = parseArgs(["restart"]);
    expect(result.subcommand).toBe("restart");
  });

  it("parses status subcommand", () => {
    const result = parseArgs(["status"]);
    expect(result.subcommand).toBe("status");
  });

  it("parses upgrade-pi subcommand (unified-bootstrap-install §8)", () => {
    const result = parseArgs(["upgrade-pi"]);
    expect(result.subcommand).toBe("upgrade-pi");
  });

  it("parses upgrade-pi with --port flag", () => {
    const result = parseArgs(["upgrade-pi", "--port", "9090"]);
    expect(result.subcommand).toBe("upgrade-pi");
    expect(result.flags.port).toBe(9090);
  });

  it("parses subcommand with flags", () => {
    const result = parseArgs(["start", "--port", "3000", "--pi-port", "4000"]);
    expect(result.subcommand).toBe("start");
    expect(result.flags.port).toBe(3000);
    expect(result.flags.piPort).toBe(4000);
  });

  it("parses flags without subcommand (foreground mode)", () => {
    const result = parseArgs(["--port", "3000", "--dev"]);
    expect(result.subcommand).toBeNull();
    expect(result.flags.port).toBe(3000);
    expect(result.flags.dev).toBe(true);
  });

  it("parses --no-tunnel flag", () => {
    const result = parseArgs(["start", "--no-tunnel"]);
    expect(result.subcommand).toBe("start");
    expect(result.flags.tunnel).toBe(false);
  });

  it("ignores unknown args", () => {
    const result = parseArgs(["start", "--unknown", "value"]);
    expect(result.subcommand).toBe("start");
    expect(result.flags).toEqual({});
  });

  it("does not treat flag values as subcommands", () => {
    const result = parseArgs(["--port", "3000"]);
    expect(result.subcommand).toBeNull();
    expect(result.flags.port).toBe(3000);
  });
});

describe("daemon spawn jiti resolution", () => {
  it("resolveJitiImport either returns a file:// URL or throws the documented error", async () => {
    // After change `support-upstream-jiti-resolution`, the resolver
    // also looks for upstream `jiti` (bare name). Vitest itself depends
    // transitively on `jiti`, so when the test runner is the anchor,
    // resolution may succeed. Either outcome is valid — we just assert
    // the contract: success returns a `file://` URL, failure throws the
    // documented error.
    const { resolveJitiImport } = await import(
      "@blackbelt-technology/pi-dashboard-shared/resolve-jiti.js"
    );
    let url: string | undefined;
    let err: Error | undefined;
    try {
      url = resolveJitiImport();
    } catch (e) {
      err = e as Error;
    }
    if (url !== undefined) {
      expect(url.startsWith("file://")).toBe(true);
    } else {
      expect(err?.message).toContain("Cannot find pi's TypeScript loader");
    }
  });
});
