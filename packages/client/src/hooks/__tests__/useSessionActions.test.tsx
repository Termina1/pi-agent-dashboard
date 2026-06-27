import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { useSessionActions, type SessionActionDeps } from "../useSessionActions.js";
import { createInitialState, type SessionState } from "../../lib/event-reducer.js";

function makeDeps(overrides: Partial<SessionActionDeps> = {}) {
  let sessionStates = new Map<string, SessionState>();
  const setSessionStates = ((updater: SetStateAction<Map<string, SessionState>>) => {
    sessionStates = typeof updater === "function" ? updater(sessionStates) : updater;
  }) as Dispatch<SetStateAction<Map<string, SessionState>>>;
  const noopSetter = vi.fn() as unknown as Dispatch<SetStateAction<any>>;

  const deps: SessionActionDeps = {
    selectedId: "selected-session",
    send: vi.fn(),
    navigate: vi.fn(),
    setMobileOpen: noopSetter,
    setSessions: noopSetter,
    setSessionStates,
    setSpawningCwds: noopSetter,
    setTerminals: noopSetter,
    clearSpawningCwd: vi.fn(),
    spawnTimeoutsRef: { current: new Map() },
    pendingTerminalCwdRef: { current: null },
    terminals: new Map(),
    pendingSpawnsRef: { current: new Map() },
    ...overrides,
  };

  return {
    deps,
    getSessionStates: () => sessionStates,
  };
}

describe("useSessionActions", () => {
  it("creates an optimistic pending prompt for direct session prompt sends", () => {
    const { deps, getSessionStates } = makeDeps({ selectedId: undefined });
    const { result } = renderHook(() => useSessionActions(deps));

    act(() => {
      result.current.handleSendPromptToSession("target-session", "Review this plan", [
        { type: "image", data: "abc123", mimeType: "image/png" },
      ]);
    });

    expect(deps.send).toHaveBeenCalledWith({
      type: "send_prompt",
      sessionId: "target-session",
      text: "Review this plan",
      images: [{ type: "image", data: "abc123", mimeType: "image/png" }],
    });
    expect(getSessionStates().get("target-session")?.pendingPrompt).toEqual({
      text: "Review this plan",
      images: [{ data: "abc123", mimeType: "image/png" }],
    });
  });

  it("preserves existing session state when adding a pending prompt", () => {
    const existing = createInitialState();
    existing.streamingText = "still here";
    let sessionStates = new Map<string, SessionState>([["target-session", existing]]);
    const setSessionStates = ((updater: SetStateAction<Map<string, SessionState>>) => {
      sessionStates = typeof updater === "function" ? updater(sessionStates) : updater;
    }) as Dispatch<SetStateAction<Map<string, SessionState>>>;
    const { deps } = makeDeps({ selectedId: undefined, setSessionStates });
    const { result } = renderHook(() => useSessionActions(deps));

    act(() => {
      result.current.handleSendPromptToSession("target-session", "Next prompt");
    });

    expect(sessionStates.get("target-session")?.streamingText).toBe("still here");
    expect(sessionStates.get("target-session")?.pendingPrompt).toEqual({
      text: "Next prompt",
      images: undefined,
    });
  });
});
