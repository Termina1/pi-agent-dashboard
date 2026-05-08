import { describe, it, expect, vi } from "vitest";
import { createCommandHandler, parseSendPrompt } from "../command-handler.js";
import type { ServerToExtensionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

describe("CommandHandler", () => {
  function createMockPi() {
    return {
      sendUserMessage: vi.fn(),
      getCommands: vi.fn().mockReturnValue([
        { name: "test", description: "Test cmd", source: "extension" as const },
      ]),
      setSessionName: vi.fn(),
      getSessionName: vi.fn(),
      on: vi.fn(),
    };
  }

  it("should call sendUserMessage on send_prompt when idle", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    const msg: ServerToExtensionMessage = {
      type: "send_prompt",
      sessionId: "s1",
      text: "Hello agent",
    };

    await handler.handle(msg);

    expect(pi.sendUserMessage).toHaveBeenCalledWith("Hello agent", { deliverAs: "followUp" });
  });

  it("should ignore messages for different sessionIds", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    const msg: ServerToExtensionMessage = {
      type: "send_prompt",
      sessionId: "s2",
      text: "Hello",
    };

    await handler.handle(msg);
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("should send images with valid mimeType via sendUserMessage", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    await handler.handle({
      type: "send_prompt",
      sessionId: "s1",
      text: "check this",
      images: [
        { type: "image", data: "abc123", mimeType: "image/png" },
      ],
    });

    expect(pi.sendUserMessage).toHaveBeenCalledWith([
      { type: "text", text: "check this" },
      { type: "image", data: "abc123", mimeType: "image/png" },
    ], { deliverAs: "followUp" });
  });

  it("should drop images with invalid mimeType and send text only", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    await handler.handle({
      type: "send_prompt",
      sessionId: "s1",
      text: "check this",
      images: [
        { type: "image", data: "abc123", mimeType: "image/bmp" },
      ],
    });

    // Invalid mimeType → dropped, sends text only
    expect(pi.sendUserMessage).toHaveBeenCalledWith("check this", { deliverAs: "followUp" });
  });

  it("should drop images with undefined or null mimeType", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    await handler.handle({
      type: "send_prompt",
      sessionId: "s1",
      text: "check this",
      images: [
        { type: "image", data: "abc123", mimeType: undefined as any },
        { type: "image", data: "abc123", mimeType: null as any },
      ],
    });

    expect(pi.sendUserMessage).toHaveBeenCalledWith("check this", { deliverAs: "followUp" });
  });

  it("should drop images with empty or non-string data", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    await handler.handle({
      type: "send_prompt",
      sessionId: "s1",
      text: "check this",
      images: [
        { type: "image", data: "", mimeType: "image/png" },
      ],
    });

    expect(pi.sendUserMessage).toHaveBeenCalledWith("check this", { deliverAs: "followUp" });
  });

  it("should drop non-object image entries", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    await handler.handle({
      type: "send_prompt",
      sessionId: "s1",
      text: "check this",
      images: [null as any, "bad" as any],
    });

    expect(pi.sendUserMessage).toHaveBeenCalledWith("check this", { deliverAs: "followUp" });
  });

  it("should keep valid images and drop invalid ones", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    await handler.handle({
      type: "send_prompt",
      sessionId: "s1",
      text: "check this",
      images: [
        { type: "image", data: "good", mimeType: "image/jpeg" },
        { type: "image", data: "bad", mimeType: "image/bmp" },
        { type: "image", data: "also-good", mimeType: "image/webp" },
      ],
    });

    expect(pi.sendUserMessage).toHaveBeenCalledWith([
      { type: "text", text: "check this" },
      { type: "image", data: "good", mimeType: "image/jpeg" },
      { type: "image", data: "also-good", mimeType: "image/webp" },
    ], { deliverAs: "followUp" });
  });

  it("should handle rename_session by calling setSessionName and returning confirmation", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    const result = await handler.handle({
      type: "rename_session",
      sessionId: "s1",
      name: "My New Name",
    });

    expect(pi.setSessionName).toHaveBeenCalledWith("My New Name");
    expect(result).toEqual({
      type: "session_name_update",
      sessionId: "s1",
      name: "My New Name",
    });
  });

  it("should call shutdown option when shutdown message received", async () => {
    const pi = createMockPi();
    const shutdown = vi.fn();
    const handler = createCommandHandler(pi as any, "s1", { shutdown });

    await handler.handle({ type: "shutdown", sessionId: "s1" } as ServerToExtensionMessage);
    expect(shutdown).toHaveBeenCalled();
  });

  it("should not crash when shutdown called without option", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    // Should not throw
    await handler.handle({ type: "shutdown", sessionId: "s1" } as ServerToExtensionMessage);
  });

  it("should call abort option when abort message received", async () => {
    const pi = createMockPi();
    const abort = vi.fn();
    const handler = createCommandHandler(pi as any, "s1", { abort });

    await handler.handle({ type: "abort", sessionId: "s1" } as ServerToExtensionMessage);
    expect(abort).toHaveBeenCalled();
  });

  it("should not crash when abort called without option", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    // Should not throw
    await handler.handle({ type: "abort", sessionId: "s1" } as ServerToExtensionMessage);
  });

  it("abort schedules persistent-abort retries until isIdle returns true", async () => {
    // See change: fix-provider-retry-infinite-loop.
    vi.useFakeTimers();
    const pi = createMockPi();
    const abort = vi.fn();
    let idleAfter = 3; // become idle after 3 polls
    const isIdle = vi.fn(() => --idleAfter <= 0);
    const handler = createCommandHandler(pi as any, "s1", { abort, isIdle, eventSink: vi.fn() });

    await handler.handle({ type: "abort", sessionId: "s1" } as ServerToExtensionMessage);
    expect(abort).toHaveBeenCalledOnce();

    // Advance through the persistent-abort schedule. Each 200ms tick
    // checks isIdle first, then calls abort if not idle.
    vi.advanceTimersByTime(200); // tick 1: idleAfter 3→2, abort
    vi.advanceTimersByTime(200); // tick 2: idleAfter 2→1, abort
    vi.advanceTimersByTime(200); // tick 3: idleAfter 1→0, isIdle true, no abort, scheduler stops
    vi.advanceTimersByTime(1000); // no more aborts

    expect(abort.mock.calls.length).toBe(3); // initial + 2 retries
    vi.useRealTimers();
  });

  it("persistent-abort scheduler stops after 2 seconds even if never idle", async () => {
    vi.useFakeTimers();
    const pi = createMockPi();
    const abort = vi.fn();
    const isIdle = vi.fn(() => false); // never idle
    const handler = createCommandHandler(pi as any, "s1", { abort, isIdle, eventSink: vi.fn() });

    await handler.handle({ type: "abort", sessionId: "s1" } as ServerToExtensionMessage);

    vi.advanceTimersByTime(2500); // safely past 2s cap
    // initial + ~10 retries (2000ms / 200ms)
    const calls = abort.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(10);
    expect(calls).toBeLessThanOrEqual(11);

    // Past cap, no more calls
    const before = abort.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(abort.mock.calls.length).toBe(before);
    vi.useRealTimers();
  });

  it("abort synthesizes auto_retry_end event after invoking abort callback (provider-retry-state)", async () => {
    // See change: fix-provider-retry-infinite-loop.
    const pi = createMockPi();
    const calls: Array<{ name: string; arg?: unknown }> = [];
    const abort = vi.fn(() => calls.push({ name: "abort" }));
    const eventSink = vi.fn((m: unknown) => calls.push({ name: "eventSink", arg: m }));
    const handler = createCommandHandler(pi as any, "s1", { abort, eventSink });

    await handler.handle({ type: "abort", sessionId: "s1" } as ServerToExtensionMessage);

    expect(abort).toHaveBeenCalledOnce();
    expect(eventSink).toHaveBeenCalledOnce();
    // Order: abort() first, then synthesized event
    expect(calls[0]!.name).toBe("abort");
    expect(calls[1]!.name).toBe("eventSink");
    const evt = (calls[1]!.arg as any);
    expect(evt.type).toBe("event_forward");
    expect(evt.sessionId).toBe("s1");
    expect(evt.event.eventType).toBe("auto_retry_end");
    expect(evt.event.data).toEqual({ success: false, attempt: -1, finalError: "Aborted by user" });
    expect(typeof evt.event.timestamp).toBe("number");
  });

  it("should handle request_commands message", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    const msg: ServerToExtensionMessage = {
      type: "request_commands",
      sessionId: "s1",
    };

    const result = await handler.handle(msg);
    expect(pi.getCommands).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result?.type).toBe("commands_list");
  });

  it("should send flows_list via eventSink on request_commands", async () => {
    const pi = createMockPi();
    (pi as any).events = {
      emit: vi.fn((event: string, probe: any) => {
        if (event === "flow:list-flows") {
          probe.flows = [{ name: "my-flow", description: "A flow", taskRequired: false }];
        }
      }),
    };
    const eventSink = vi.fn();
    const handler = createCommandHandler(pi as any, "s1", { eventSink });

    await handler.handle({ type: "request_commands", sessionId: "s1" });
    expect(eventSink).toHaveBeenCalledWith({
      type: "flows_list",
      sessionId: "s1",
      flows: [{ name: "my-flow", description: "A flow", taskRequired: false }],
    });
  });

  it("should send empty flows_list when pi-flows is not installed", async () => {
    const pi = createMockPi();
    // No events property — pi-flows not installed
    const eventSink = vi.fn();
    const handler = createCommandHandler(pi as any, "s1", { eventSink });

    await handler.handle({ type: "request_commands", sessionId: "s1" });
    expect(eventSink).toHaveBeenCalledWith({
      type: "flows_list",
      sessionId: "s1",
      flows: [],
    });
  });

  it("should filter hidden commands (starting with __) from commands list", async () => {
    const pi = createMockPi();
    pi.getCommands.mockReturnValue([
      { name: "test", description: "Test cmd", source: "extension" as const },
      { name: "__dashboard", source: "extension" as const },
      { name: "__internal", source: "extension" as const },
      { name: "review", description: "Review", source: "prompt" as const },
    ]);
    const handler = createCommandHandler(pi as any, "s1");

    const result = await handler.handle({ type: "request_commands", sessionId: "s1" });
    expect(result?.type).toBe("commands_list");
    const commands = (result as any).commands;
    expect(commands).toHaveLength(2);
    expect(commands.map((c: any) => c.name)).toEqual(["test", "review"]);
  });

  it("should handle list_sessions gracefully when SessionManager is unavailable", async () => {
    const pi = createMockPi();
    const handler = createCommandHandler(pi as any, "s1");

    const result = await handler.handle({
      type: "list_sessions",
      sessionId: "s1",
      cwd: "/some/path",
    } as any);

    // Should return empty array on import failure
    expect(result).toBeDefined();
    expect(result!.type).toBe("sessions_list");
    expect((result as any).sessions).toEqual([]);
  });

  it("should use sessionId getter for dynamic session ID", async () => {
    const pi = createMockPi();
    let currentId = "s1";
    const handler = createCommandHandler(pi as any, () => currentId);

    // Message for s1 should work
    await handler.handle({ type: "send_prompt", sessionId: "s1", text: "hello" });
    expect(pi.sendUserMessage).toHaveBeenCalledWith("hello", { deliverAs: "followUp" });

    pi.sendUserMessage.mockClear();

    // Change the session ID
    currentId = "s2";

    // Now message for s1 should be ignored
    await handler.handle({ type: "send_prompt", sessionId: "s1", text: "ignored" });
    expect(pi.sendUserMessage).not.toHaveBeenCalled();

    // And message for s2 should work
    await handler.handle({ type: "send_prompt", sessionId: "s2", text: "accepted" });
    expect(pi.sendUserMessage).toHaveBeenCalledWith("accepted", { deliverAs: "followUp" });
  });

  describe("command routing", () => {
    it("should route !!command as silent bash execution", async () => {
      const pi = createMockPi();
      const exec = vi.fn().mockResolvedValue({ stdout: "output", stderr: "", exitCode: 0 });
      (pi as any).exec = exec;
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "!!ls -la" });

      expect(exec).toHaveBeenCalledWith("sh", ["-c", "ls -la"], expect.objectContaining({ timeout: 30000 }));
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "bash_output",
          data: expect.objectContaining({ command: "ls -la", excludeFromContext: true }),
        }),
      }));
    });

    it("should route !command as bash execution + LLM send", async () => {
      const pi = createMockPi();
      const exec = vi.fn().mockResolvedValue({ stdout: "file.txt", stderr: "", exitCode: 0 });
      (pi as any).exec = exec;
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "!ls" });

      expect(exec).toHaveBeenCalledWith("sh", ["-c", "ls"], expect.objectContaining({ timeout: 30000 }));
      expect(pi.sendUserMessage).toHaveBeenCalled();
      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "bash_output",
          data: expect.objectContaining({ command: "ls", excludeFromContext: false }),
        }),
      }));
    });

    it("should fall through for empty bang commands", async () => {
      const pi = createMockPi();
      const handler = createCommandHandler(pi as any, "s1");

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "!" });
      expect(pi.sendUserMessage).toHaveBeenCalledWith("!", { deliverAs: "followUp" });

      pi.sendUserMessage.mockClear();
      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "!!" });
      expect(pi.sendUserMessage).toHaveBeenCalledWith("!!", { deliverAs: "followUp" });
    });

    it("should route /compact to ctx.compact()", async () => {
      const pi = createMockPi();
      const compact = vi.fn();
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { compact, eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/compact" });

      expect(compact).toHaveBeenCalledWith({});
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "command_feedback",
          data: expect.objectContaining({ command: "/compact", status: "started" }),
        }),
      }));
    });

    it("should route /compact with custom instructions", async () => {
      const pi = createMockPi();
      const compact = vi.fn();
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { compact, eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/compact summarize only code" });

      expect(compact).toHaveBeenCalledWith({ customInstructions: "summarize only code" });
    });

    it("should send error feedback when compact fails", async () => {
      const pi = createMockPi();
      const compact = vi.fn().mockImplementation(() => { throw new Error("Already compacted"); });
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { compact, eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/compact" });

      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "command_feedback",
          data: expect.objectContaining({ command: "/compact", status: "error", message: "Already compacted" }),
        }),
      }));
    });

    it("should route /slash commands through sessionPrompt when available", async () => {
      const pi = createMockPi();
      const sessionPrompt = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { sessionPrompt });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/some-command args" });

      expect(sessionPrompt).toHaveBeenCalledWith("/some-command args");
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
    });

    it("should emit command_feedback for slash commands", async () => {
      const pi = createMockPi();
      const sessionPrompt = vi.fn();
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { sessionPrompt, eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/reload" });

      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "command_feedback",
          data: expect.objectContaining({ command: "/reload", status: "completed" }),
        }),
      }));
    });

    it("should emit command_feedback for slash commands even without sessionPrompt", async () => {
      const pi = createMockPi();
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/some-command" });

      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "command_feedback",
          data: expect.objectContaining({ command: "/some-command", status: "completed" }),
        }),
      }));
    });

    it("should fallback to sendUserMessage when sessionPrompt is not available for slash commands", async () => {
      const pi = createMockPi();
      const handler = createCommandHandler(pi as any, "s1");

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/some-command args" });

      expect(pi.sendUserMessage).toHaveBeenCalledWith("/some-command args");
    });

    it("should route /quit to shutdown", async () => {
      const pi = createMockPi();
      const shutdown = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { shutdown });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/quit" });

      expect(shutdown).toHaveBeenCalled();
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
    });

    it("should route /exit to shutdown", async () => {
      const pi = createMockPi();
      const shutdown = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { shutdown });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/exit" });

      expect(shutdown).toHaveBeenCalled();
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
    });

    it("should route /reload to reload callback", async () => {
      const pi = createMockPi();
      const reload = vi.fn();
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { reload, eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/reload" });

      expect(reload).toHaveBeenCalled();
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "command_feedback",
          data: expect.objectContaining({ command: "/reload", status: "completed" }),
        }),
      }));
    });

    it("should not crash when /reload called without option", async () => {
      const pi = createMockPi();
      const handler = createCommandHandler(pi as any, "s1");

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/reload" });
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
    });

    it("should route /new to spawnNew callback", async () => {
      const pi = createMockPi();
      const spawnNew = vi.fn();
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { spawnNew, eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "/new" });

      expect(spawnNew).toHaveBeenCalled();
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "command_feedback",
          data: expect.objectContaining({ command: "/new", status: "completed" }),
        }),
      }));
    });

    it("should pass plain text through to sendUserMessage", async () => {
      const pi = createMockPi();
      const handler = createCommandHandler(pi as any, "s1");

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "explain this code" });

      expect(pi.sendUserMessage).toHaveBeenCalledWith("explain this code", { deliverAs: "followUp" });
    });

    it("should handle bash execution with non-zero exit code", async () => {
      const pi = createMockPi();
      const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "not found", exitCode: 127 });
      (pi as any).exec = exec;
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { eventSink });

      await handler.handle({ type: "send_prompt", sessionId: "s1", text: "!!badcmd" });

      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "bash_output",
          data: expect.objectContaining({ exitCode: 127, output: "not found" }),
        }),
      }));
    });
  });

  describe("set_model", () => {
    it("should call setModel with provider and modelId", async () => {
      const pi = createMockPi();
      const setModel = vi.fn().mockResolvedValue(undefined);
      const handler = createCommandHandler(pi as any, "s1", { setModel });

      await handler.handle({
        type: "set_model",
        sessionId: "s1",
        provider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
      } as ServerToExtensionMessage);

      expect(setModel).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-20250514");
    });

    it("should not throw when setModel option is not provided", async () => {
      const pi = createMockPi();
      const handler = createCommandHandler(pi as any, "s1");

      await expect(handler.handle({
        type: "set_model",
        sessionId: "s1",
        provider: "anthropic",
        modelId: "unknown-model",
      } as ServerToExtensionMessage)).resolves.toBeUndefined();
    });

    it("should route /model slash command through setModel callback", async () => {
      const pi = createMockPi();
      const setModel = vi.fn().mockResolvedValue(undefined);
      const eventSink = vi.fn();
      const handler = createCommandHandler(pi as any, "s1", { setModel, eventSink });

      await handler.handle({
        type: "send_prompt",
        sessionId: "s1",
        text: "/model anthropic/claude-haiku-4-5",
      });

      expect(setModel).toHaveBeenCalledWith("anthropic", "claude-haiku-4-5");
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      expect(eventSink).toHaveBeenCalledWith(expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({
          eventType: "command_feedback",
          data: expect.objectContaining({ command: "/model anthropic/claude-haiku-4-5", status: "completed" }),
        }),
      }));
    });
  });
});

describe("parseSendPrompt", () => {
  it("should detect !! prefix (silent bash)", () => {
    const result = parseSendPrompt("!!ls -la");
    expect(result).toEqual({ type: "bash", command: "ls -la", excludeFromContext: true });
  });

  it("should detect ! prefix (bash with LLM)", () => {
    const result = parseSendPrompt("!git status");
    expect(result).toEqual({ type: "bash", command: "git status", excludeFromContext: false });
  });

  it("should return passthrough for empty !! ", () => {
    const result = parseSendPrompt("!!");
    expect(result).toEqual({ type: "passthrough", text: "!!" });
  });

  it("should return passthrough for empty !", () => {
    const result = parseSendPrompt("!");
    expect(result).toEqual({ type: "passthrough", text: "!" });
  });

  it("should detect /compact without args", () => {
    const result = parseSendPrompt("/compact");
    expect(result).toEqual({ type: "compact", customInstructions: undefined });
  });

  it("should detect /compact with args", () => {
    const result = parseSendPrompt("/compact focus on code changes");
    expect(result).toEqual({ type: "compact", customInstructions: "focus on code changes" });
  });

  it("should detect generic slash commands", () => {
    const result = parseSendPrompt("/some-command arg1 arg2");
    expect(result).toEqual({ type: "slash", text: "/some-command arg1 arg2" });
  });

  it("should return passthrough for plain text", () => {
    const result = parseSendPrompt("explain this code");
    expect(result).toEqual({ type: "passthrough", text: "explain this code" });
  });

  it("should return passthrough for text with / in the middle", () => {
    const result = parseSendPrompt("look at src/index.ts");
    expect(result).toEqual({ type: "passthrough", text: "look at src/index.ts" });
  });

  it("should trim bang command text", () => {
    const result = parseSendPrompt("!!  ls -la  ");
    expect(result).toEqual({ type: "bash", command: "ls -la", excludeFromContext: true });
  });

  it("should return passthrough for !! with only whitespace after", () => {
    const result = parseSendPrompt("!!   ");
    expect(result).toEqual({ type: "passthrough", text: "!!   " });
  });

  it("should detect /quit as shutdown", () => {
    expect(parseSendPrompt("/quit")).toEqual({ type: "shutdown" });
  });

  it("should detect /exit as shutdown", () => {
    expect(parseSendPrompt("/exit")).toEqual({ type: "shutdown" });
  });

  it("should detect /reload as reload", () => {
    expect(parseSendPrompt("/reload")).toEqual({ type: "reload" });
  });

  it("should detect /new as new", () => {
    expect(parseSendPrompt("/new")).toEqual({ type: "new" });
  });

  it("should detect /model provider/id as model command", () => {
    expect(parseSendPrompt("/model anthropic/claude-haiku-4-5")).toEqual({
      type: "model",
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
    });
  });

  it("should treat /model without slash in arg as generic slash", () => {
    expect(parseSendPrompt("/model something")).toEqual({ type: "slash", text: "/model something" });
  });

  it("should treat bare /model as generic slash", () => {
    expect(parseSendPrompt("/model")).toEqual({ type: "slash", text: "/model" });
  });

  it("should detect /flows:new as generic slash (routed by bridge sessionPrompt)", () => {
    expect(parseSendPrompt("/flows:new create a test flow")).toEqual({
      type: "slash",
      text: "/flows:new create a test flow",
    });
  });

  it("should detect /flows:delete as generic slash (routed by session.prompt)", () => {
    expect(parseSendPrompt("/flows:delete my-flow")).toEqual({
      type: "slash",
      text: "/flows:delete my-flow",
    });
  });
});
