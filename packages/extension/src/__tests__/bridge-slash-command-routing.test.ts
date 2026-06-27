import { describe, it, expect, vi } from "vitest";
import { createCommandHandler } from "../command-handler.js";
import type { ExtensionToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

interface StubOpts {
  getCommandsThrows?: boolean;
  commands?: Array<{ name: string; source: string; handler?: (args: string, ctx: any) => unknown }>;
}

function makeStubPi(opts: StubOpts = {}) {
  const sendUserMessage = vi.fn();
  const setSessionName = vi.fn();
  const events = { emit: vi.fn() };
  const getCommands = vi.fn(() => {
    if (opts.getCommandsThrows) throw new Error("stale ctx");
    return opts.commands ?? [
      { name: "ctx-stats", source: "extension" },
      { name: "skill:foo", source: "skill" },
      { name: "review", source: "prompt" },
      { name: "__dashboard_reload", source: "extension" },
    ];
  });
  const pi: any = { sendUserMessage, getCommands, setSessionName, events };
  return { pi, sendUserMessage, getCommands, events };
}

function feedbackEvents(sink: ReturnType<typeof vi.fn>, command: string) {
  return sink.mock.calls
    .map((c) => c[0] as ExtensionToServerMessage)
    .filter(
      (m) =>
        m.type === "event_forward" &&
        (m as any).event?.eventType === "command_feedback" &&
        (m as any).event?.data?.command === command,
    )
    .map((m) => (m as any).event.data);
}

async function drive(text: string, stub: ReturnType<typeof makeStubPi>) {
  const sink = vi.fn();
  const handler = createCommandHandler(stub.pi as any, "s1", { eventSink: sink });
  await handler.handle({ type: "send_prompt", sessionId: "s1", text } as any);
  return sink;
}

describe("bridge slash command routing (regression contract)", () => {
  it("extension cmd with exposed handler → handler called, no sendUserMessage, started+completed", async () => {
    const handler = vi.fn();
    const stub = makeStubPi({ commands: [{ name: "ctx-stats", source: "extension", handler }] });
    const sink = await drive("/ctx-stats", stub);

    expect(handler).toHaveBeenCalledWith("", undefined);
    expect(stub.sendUserMessage).not.toHaveBeenCalled();
    expect(feedbackEvents(sink, "/ctx-stats").map((e) => e.status)).toEqual(["started", "completed"]);
  });

  it("extension cmd with args and exposed handler → passes args", async () => {
    const handler = vi.fn();
    const stub = makeStubPi({ commands: [{ name: "ctx-stats", source: "extension", handler }] });
    const sink = await drive("/ctx-stats verbose=1", stub);

    expect(handler).toHaveBeenCalledWith("verbose=1", undefined);
    expect(stub.sendUserMessage).not.toHaveBeenCalled();
    expect(feedbackEvents(sink, "/ctx-stats verbose=1").map((e) => e.status)).toEqual(["started", "completed"]);
  });

  it("extension cmd metadata only → unsupported error, no sendUserMessage", async () => {
    const stub = makeStubPi();
    const sink = await drive("/ctx-stats", stub);

    expect(stub.sendUserMessage).not.toHaveBeenCalled();
    const evs = feedbackEvents(sink, "/ctx-stats");
    expect(evs.map((e) => e.status)).toEqual(["started", "error"]);
    expect(evs[1].message).toMatch(/no command invocation API/);
  });

  it("extension cmd handler rejects → started+error with err.message, no sendUserMessage", async () => {
    const stub = makeStubPi({
      commands: [{ name: "ctx-stats", source: "extension", handler: vi.fn(async () => { throw new Error("boom"); }) }],
    });
    const sink = await drive("/ctx-stats", stub);

    expect(stub.sendUserMessage).not.toHaveBeenCalled();
    const evs = feedbackEvents(sink, "/ctx-stats");
    expect(evs.map((e) => e.status)).toEqual(["started", "error"]);
    expect(evs[1].message).toBe("boom");
  });

  it("skill command → no dispatch, sendUserMessage called once, no command_feedback", async () => {
    const stub = makeStubPi();
    const sink = await drive("/skill:foo", stub);
    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(feedbackEvents(sink, "/skill:foo")).toEqual([]);
  });

  it("prompt template → no dispatch, sendUserMessage called once, no command_feedback", async () => {
    const stub = makeStubPi();
    const sink = await drive("/review", stub);
    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(feedbackEvents(sink, "/review")).toEqual([]);
  });

  it("passthrough text → sendUserMessage uses steering delivery", async () => {
    const stub = makeStubPi();
    await drive("hello world", stub);
    expect(stub.sendUserMessage).toHaveBeenCalledWith("hello world", { deliverAs: "steer" });
  });

  it("unrecognized slash → sendUserMessage called once, no command_feedback", async () => {
    const stub = makeStubPi();
    const sink = await drive("/totally-unknown-command", stub);
    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(feedbackEvents(sink, "/totally-unknown-command")).toEqual([]);
  });

  it("bridge-native /__dashboard_reload → no error feedback, sendUserMessage fallback", async () => {
    const stub = makeStubPi();
    const sink = await drive("/__dashboard_reload", stub);
    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(feedbackEvents(sink, "/__dashboard_reload")).toEqual([]);
  });

  it("getCommands throws → no crash, no command_feedback, sendUserMessage fallback fires", async () => {
    const stub = makeStubPi({ getCommandsThrows: true });
    const sink = await drive("/ctx-stats", stub);
    expect(stub.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(feedbackEvents(sink, "/ctx-stats")).toEqual([]);
  });

  it("never duplicates command_feedback on handler success path", async () => {
    const stub = makeStubPi({ commands: [{ name: "ctx-stats", source: "extension", handler: vi.fn() }] });
    const sink = await drive("/ctx-stats", stub);
    const evs = feedbackEvents(sink, "/ctx-stats");
    expect(evs.filter((e) => e.status === "started")).toHaveLength(1);
    expect(evs.filter((e) => e.status === "completed" || e.status === "error")).toHaveLength(1);
  });

  it("never duplicates command_feedback on metadata-only path", async () => {
    const stub = makeStubPi();
    const sink = await drive("/ctx-stats", stub);
    const evs = feedbackEvents(sink, "/ctx-stats");
    expect(evs.filter((e) => e.status === "started")).toHaveLength(1);
    expect(evs.filter((e) => e.status === "completed" || e.status === "error")).toHaveLength(1);
  });

  it("anti-regression: extension metadata-only command NEVER reaches sendUserMessage", async () => {
    const stub = makeStubPi();
    await drive("/ctx-stats", stub);
    expect(stub.sendUserMessage).not.toHaveBeenCalled();
  });
});
