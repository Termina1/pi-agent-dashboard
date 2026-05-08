/**
 * On-connect snapshot semantics: emits exactly one `openspec_update`
 * per known cwd, with correct `pending` value.
 *
 * See change: fix-cold-boot-openspec-protocol.
 */
import { describe, it, expect, vi } from "vitest";
import { buildOpenSpecConnectSnapshot } from "../browser-gateway.js";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function ds(map: Record<string, OpenSpecData | undefined>) {
  return {
    knownDirectories: vi.fn(() => Object.keys(map)),
    getOpenSpecData: vi.fn((cwd: string) => map[cwd]),
  };
}

describe("buildOpenSpecConnectSnapshot", () => {
  it("emits cached payload for cwds with initialized data (no pending field)", () => {
    const cached: OpenSpecData = { initialized: true, changes: [{ name: "x" } as never] };
    const msgs = buildOpenSpecConnectSnapshot(ds({ "/p": cached }), () => true);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ type: "openspec_update", cwd: "/p", data: cached });
  });

  it("emits pending: true when openspec dir exists but cache is empty", () => {
    const msgs = buildOpenSpecConnectSnapshot(
      ds({ "/p": { initialized: false, changes: [] } }),
      (cwd) => cwd === "/p",
    );
    expect(msgs).toEqual([
      {
        type: "openspec_update",
        cwd: "/p",
        data: { initialized: false, pending: true, changes: [] },
      },
    ]);
  });

  it("emits pending: true when openspec dir exists but cache is undefined", () => {
    const msgs = buildOpenSpecConnectSnapshot(
      ds({ "/p": undefined }),
      () => true,
    );
    expect(msgs).toEqual([
      {
        type: "openspec_update",
        cwd: "/p",
        data: { initialized: false, pending: true, changes: [] },
      },
    ]);
  });

  it("emits pending: false when no openspec dir exists", () => {
    const msgs = buildOpenSpecConnectSnapshot(
      ds({ "/p": undefined }),
      () => false,
    );
    expect(msgs).toEqual([
      {
        type: "openspec_update",
        cwd: "/p",
        data: { initialized: false, pending: false, changes: [] },
      },
    ]);
  });

  it("emits exactly one message per known cwd, mixed states preserved", () => {
    const cached: OpenSpecData = { initialized: true, changes: [{ name: "x" } as never] };
    const map = { "/hot": cached, "/cold": undefined, "/none": undefined };
    const msgs = buildOpenSpecConnectSnapshot(
      ds(map),
      (cwd) => cwd === "/cold",
    );
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toEqual({ type: "openspec_update", cwd: "/hot", data: cached });
    expect(msgs[1]).toEqual({
      type: "openspec_update",
      cwd: "/cold",
      data: { initialized: false, pending: true, changes: [] },
    });
    expect(msgs[2]).toEqual({
      type: "openspec_update",
      cwd: "/none",
      data: { initialized: false, pending: false, changes: [] },
    });
  });

  it("returns empty array when there are no known directories", () => {
    expect(buildOpenSpecConnectSnapshot(ds({}), () => true)).toEqual([]);
  });
});
