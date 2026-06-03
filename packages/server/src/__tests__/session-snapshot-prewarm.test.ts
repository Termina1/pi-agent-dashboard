import { describe, it, expect, vi } from "vitest";
import { createMemoryEventStore } from "../memory-event-store.js";
import { createMemorySessionManager } from "../memory-session-manager.js";
import { wireEvents } from "../event-wiring.js";
import { discoverAndBroadcastSessions } from "../session-bootstrap.js";
import { createSessionSnapshotPrewarmQueue } from "../session-snapshot-store.js";

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("session snapshot prewarm queue", () => {
  it("processes newer activity before older activity at low concurrency", async () => {
    const order: string[] = [];
    const queue = createSessionSnapshotPrewarmQueue({
      concurrency: 1,
      build: async (job) => {
        order.push(job.sessionId);
      },
    });

    queue.enqueueMany([
      { sessionId: "old", sessionFile: "/tmp/old.jsonl", activityAt: 10 },
      { sessionId: "new", sessionFile: "/tmp/new.jsonl", activityAt: 30 },
      { sessionId: "mid", sessionFile: "/tmp/mid.jsonl", activityAt: 20 },
    ]);

    await queue.onIdle();
    expect(order).toEqual(["new", "mid", "old"]);
  });

  it("enqueue returns without waiting for the build", async () => {
    let started = false;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const queue = createSessionSnapshotPrewarmQueue({
      concurrency: 1,
      build: async () => {
        started = true;
        await blocked;
      },
    });

    queue.enqueue({ sessionId: "s1", sessionFile: "/tmp/s1.jsonl", activityAt: 1 });
    expect(started).toBe(false);
    await wait();
    expect(started).toBe(true);
    release();
    await queue.onIdle();
  });
});

describe("session snapshot startup and live hooks", () => {
  it("startup discovery enqueues discovered sessions newest first without awaiting prewarm", async () => {
    const sessionManager = createMemorySessionManager();
    const browserGateway = { broadcastSessionAdded: vi.fn(), broadcastToAll: vi.fn() } as any;
    const prewarmQueue = { enqueueMany: vi.fn() };
    const directoryService = {
      knownDirectories: () => ["/repo"],
      discoverSessions: () => [
        { id: "old", cwd: "/repo", startedAt: 1, modifiedAt: 10, sessionFile: "/tmp/old.jsonl", sessionDir: "/tmp" },
        { id: "new", cwd: "/repo", startedAt: 2, modifiedAt: 30, sessionFile: "/tmp/new.jsonl", sessionDir: "/tmp" },
      ],
      startPolling: vi.fn(),
      getOpenSpecData: vi.fn(),
      refreshOpenSpec: vi.fn(async () => ({ initialized: false, changes: [] })),
    } as any;

    await discoverAndBroadcastSessions({ sessionManager, browserGateway, directoryService, prewarmQueue });

    expect(prewarmQueue.enqueueMany).toHaveBeenCalledWith([
      { sessionId: "new", sessionFile: "/tmp/new.jsonl", activityAt: 30, contextWindow: undefined },
      { sessionId: "old", sessionFile: "/tmp/old.jsonl", activityAt: 10, contextWindow: undefined },
    ]);
  });

  it("agent_end enqueues a snapshot refresh for sessions with a session file", () => {
    const sessionManager = createMemorySessionManager();
    sessionManager.restore({
      id: "s1",
      cwd: "/repo",
      source: "tui",
      status: "active",
      startedAt: 1,
      sessionFile: "/tmp/s1.jsonl",
      contextWindow: 1_000_000,
    } as any);

    const piGateway: any = { sendToSession: vi.fn(), isSessionConnected: vi.fn(() => true) };
    const browserGateway: any = {
      broadcastEvent: vi.fn(),
      broadcastSessionUpdated: vi.fn(),
      sendToSubscribers: vi.fn(),
      broadcastSessionAdded: vi.fn(),
      broadcastSessionRemoved: vi.fn(),
      broadcastSessionStateReset: vi.fn(),
      broadcastToAll: vi.fn(),
      headlessPidRegistry: { linkByToken: vi.fn(), linkByPid: vi.fn(), linkSession: vi.fn() },
      pendingResumeRegistry: { consume: vi.fn() },
    };
    const snapshotPrewarmQueue = { enqueue: vi.fn() };

    wireEvents({
      sessionManager,
      eventStore: createMemoryEventStore(() => false),
      piGateway,
      browserGateway,
      sessionOrderManager: { insert: vi.fn(), moveToFront: vi.fn(), getOrder: vi.fn(() => []), getAllOrders: vi.fn(() => ({})) } as any,
      pendingForkRegistry: { consumeFork: vi.fn() } as any,
      directoryService: { onDirectoryAdded: vi.fn() } as any,
      knownSessionIds: new Set(["s1"]),
      pendingDashboardSpawns: new Map(),
      snapshotPrewarmQueue,
    });

    piGateway.onEvent("s1", {
      type: "event_forward",
      sessionId: "s1",
      event: { eventType: "agent_end", timestamp: 1000, data: {} },
    });

    expect(snapshotPrewarmQueue.enqueue).toHaveBeenCalledWith({
      sessionId: "s1",
      sessionFile: "/tmp/s1.jsonl",
      contextWindow: 1_000_000,
      activityAt: 1000,
    });
  });
});
