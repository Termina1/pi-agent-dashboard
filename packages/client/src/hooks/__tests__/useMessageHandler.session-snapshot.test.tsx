import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMessageHandler } from "../useMessageHandler.js";
import { createInitialState, type SessionState } from "../../lib/event-reducer.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

function setup(initial: Map<string, SessionState>) {
  const sessionStatesRef = { current: initial };
  const maxSeqMap = new Map<string, number>([["s1", 42]]);

  const setSessionStates = vi.fn((updater: any) => {
    sessionStatesRef.current = typeof updater === "function"
      ? updater(sessionStatesRef.current)
      : updater;
  });

  const setters: any = {
    setSessions: vi.fn(),
    setSessionStates,
    setSessionCommands: vi.fn(),
    setSessionFlows: vi.fn(),
    setFileResults: vi.fn(),
    setOpenspecMap: vi.fn(),
    setOpenspecGroupsMap: vi.fn(),
    setModelsMap: vi.fn(),
    setRolesMap: vi.fn(),
    setSpawnResult: vi.fn(),
    setSessionOrderMap: vi.fn(),
    setPinnedDirectories: vi.fn(),
    setTerminals: vi.fn(),
    setEditorStatuses: vi.fn(),
    setDiscoveredServers: vi.fn(),
    setSpawnErrors: vi.fn(),
    setResumeErrors: vi.fn(),
  };

  const deps: any = {
    send: vi.fn(),
    navigate: vi.fn(),
    clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() },
    subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null },
    lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: maxSeqMap },
    selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: new Map() },
  };

  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return { dispatch: (msg: ServerToBrowserMessage) => result.current(msg), sessionStatesRef, setSessionStates, maxSeqMap };
}

describe("useMessageHandler session_snapshot hydration", () => {
  it("replaces only the target session state in one update and clears streaming text", () => {
    const stale: SessionState = {
      ...createInitialState(),
      messages: [{ id: "old", role: "assistant", content: "old", timestamp: 1 }],
      streamingText: "partial",
      isStreaming: true,
    };
    const other: SessionState = {
      ...createInitialState(),
      messages: [{ id: "other", role: "user", content: "keep", timestamp: 2 }],
      streamingText: "keep-streaming",
    };

    const { dispatch, sessionStatesRef, setSessionStates, maxSeqMap } = setup(new Map([
      ["s1", stale],
      ["s2", other],
    ]));

    dispatch({
      type: "session_snapshot",
      sessionId: "s1",
      snapshot: {
        schemaVersion: 1,
        projectorVersion: 1,
        source: { sessionFile: "/tmp/s1.jsonl", size: 123, mtimeMs: 456 },
        builtAt: 789,
        transcript: {
          messages: [{ id: "new", role: "assistant", content: "hydrated", timestamp: 3, entryId: "e2" }],
          tokensIn: 10,
          tokensOut: 20,
          cacheRead: 3,
          cacheWrite: 4,
          cost: 0.5,
          model: "anthropic/claude-sonnet-4",
          contextUsage: { tokens: 30, contextWindow: 200000 },
          hasFileChanges: true,
          turnStats: [{ input: 10, output: 20, cacheRead: 3, cacheWrite: 4, turnIndex: 0 }],
          turnCount: 1,
        },
      },
    } as ServerToBrowserMessage);

    expect(setSessionStates).toHaveBeenCalledTimes(1);
    const hydrated = sessionStatesRef.current.get("s1")!;
    expect(hydrated.messages).toEqual([{ id: "new", role: "assistant", content: "hydrated", timestamp: 3, entryId: "e2" }]);
    expect(hydrated.streamingText).toBe("");
    expect(hydrated.streamingThinking).toBe("");
    expect(hydrated.isStreaming).toBe(false);
    expect(hydrated.tokensIn).toBe(10);
    expect(hydrated.tokensOut).toBe(20);
    expect(hydrated.cacheRead).toBe(3);
    expect(hydrated.cacheWrite).toBe(4);
    expect(hydrated.cost).toBe(0.5);
    expect(hydrated.model).toBe("anthropic/claude-sonnet-4");
    expect(hydrated.contextUsage).toEqual({ tokens: 30, contextWindow: 200000 });
    expect(hydrated.hasFileChanges).toBe(true);
    expect(hydrated.turnStats).toEqual([{ input: 10, output: 20, cacheRead: 3, cacheWrite: 4, turnIndex: 0 }]);
    expect(hydrated.status).toBe("ended");
    expect(sessionStatesRef.current.get("s2")).toBe(other);
    expect(maxSeqMap.get("s1")).toBe(0);
  });
});
