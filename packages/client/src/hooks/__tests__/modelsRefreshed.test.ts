/**
 * Tests for models_refreshed message handling.
 *
 * After change `simplify-model-selection-channels`, `models_refreshed` is a
 * no-op on the client. The previous behaviour (wipe all of modelsMap, then
 * re-request for the selected session) caused previously-visited sessions
 * in `subscribedRef` to lose their dropdown contents because the auto-
 * subscribe effect only fires `request_models` on first visit. The client
 * now relies entirely on per-session `models_list` updates which the bridge
 * pushes on credential changes — a self-healing channel that never wipes
 * other sessions.
 *
 * The case is preserved as a no-op for protocol-compatibility with older
 * bridges that may still emit it.
 */
import { describe, it, expect, vi } from "vitest";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// Pure helper that mirrors the no-op handler in useMessageHandler.ts.
function handleModelsRefreshed(
  prevModelsMap: Map<string, ModelInfo[]>,
  selectedSessionId: string | undefined,
  send: (msg: any) => void,
): Map<string, ModelInfo[]> {
  // No-op: do not wipe, do not re-request. See comment above.
  void selectedSessionId;
  void send;
  return prevModelsMap;
}

describe("models_refreshed handler (no-op contract)", () => {
  it("does NOT clear cached model lists", () => {
    const prev = new Map<string, ModelInfo[]>();
    prev.set("s1", [{ provider: "anthropic", id: "claude-4" }]);
    prev.set("s2", []);

    const result = handleModelsRefreshed(prev, "s1", vi.fn());

    expect(result.size).toBe(2);
    expect(result.get("s1")).toEqual([{ provider: "anthropic", id: "claude-4" }]);
  });

  it("does NOT send request_models even when a session is selected", () => {
    const send = vi.fn();
    const prev = new Map<string, ModelInfo[]>();
    prev.set("s1", []);

    handleModelsRefreshed(prev, "s1", send);

    expect(send).not.toHaveBeenCalled();
  });

  it("does NOT send request_models when no session is selected", () => {
    const send = vi.fn();
    const prev = new Map<string, ModelInfo[]>();

    handleModelsRefreshed(prev, undefined, send);

    expect(send).not.toHaveBeenCalled();
  });
});
