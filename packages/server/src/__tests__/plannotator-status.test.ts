import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectSession(piPort: number, sessionId: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${piPort}`);
  await new Promise<void>((resolve) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session_register",
        sessionId,
        cwd: "/tmp",
        source: "dashboard",
      }));
      ws.send(JSON.stringify({ type: "replay_complete", sessionId }));
      setTimeout(resolve, 60);
    });
  });
  return ws;
}

describe("plannotator_status — server wiring", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;
  let testPort = 19600;

  beforeEach(async () => {
    testPort += 2;
    browserPort = testPort;
    piPort = testPort + 1;
    server = await createServer({
      port: browserPort,
      piPort,
      dev: true,
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
      editor: { idleTimeoutMinutes: 10, maxInstances: 3 },
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("stores bridge-reported Plannotator phase and broadcasts it to browsers", async () => {
    const browserWs = new WebSocket(`ws://localhost:${browserPort}/ws`);
    const browserMessages: any[] = [];
    await new Promise<void>((resolve) => browserWs.on("open", () => resolve()));
    browserWs.on("message", (raw) => {
      try {
        browserMessages.push(JSON.parse(raw.toString()));
      } catch { /* ignore */ }
    });

    const piWs = await connectSession(piPort, "p1");
    browserMessages.length = 0;

    piWs.send(JSON.stringify({
      type: "plannotator_status",
      sessionId: "p1",
      available: true,
      phase: "planning",
    }));

    await wait(80);

    expect(server.sessionManager.get("p1")?.plannotator).toMatchObject({
      available: true,
      phase: "planning",
    });
    const statusUpdate = browserMessages.find(
      (msg) => msg.type === "session_updated" && msg.sessionId === "p1" && msg.updates?.plannotator,
    );
    expect(statusUpdate?.updates.plannotator).toMatchObject({
      available: true,
      phase: "planning",
    });

    piWs.close();
    browserWs.close();
  });
});
