/**
 * Shared extension-slash-command dispatch branch used by both bridge.ts
 * (sessionPrompt callback) and command-handler.ts (slash else-arm fallback).
 *
 * Routing-step 9 from `command-routing` spec:
 *   - if text matches a registered extension command (per pi.getCommands(),
 *     filtered through `isExtensionSlashCommand`) and a callable handler is
 *     exposed by pi, invoke that handler.
 *   - current pi releases expose command metadata but do not expose a public
 *     command-dispatch API, so metadata-only commands are reported as
 *     unsupported instead of being sent to the LLM.
 *   - if text is NOT an extension command, return `false` so the caller can
 *     fall through to its existing template-expansion / sendUserMessage path.
 *
 * Guarantees: EXACTLY ONE `started` event and EXACTLY ONE terminal event
 * (`completed` xor `error`) per dispatch. No `sendUserMessage` is invoked
 * by this helper — that is the caller's responsibility on the false return.
 *
 * See change: fix-extension-slash-commands-in-dashboard.
 */
import type { ExtensionToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { isExtensionSlashCommand } from "./bridge-context.js";

export type FeedbackSink = (msg: ExtensionToServerMessage) => void;

const COMMAND_UNSUPPORTED =
  "Extension slash commands cannot be dispatched from the dashboard because the installed pi API exposes command metadata but no command invocation API. Invoke from the pi TUI, or use the extension's tools directly.";
const PLANNOTATOR_UNSUPPORTED =
  "Dashboard cannot enter Plannotator plan mode with /plannotator on the installed pi API: pi exposes only command metadata, not the command handler. Start Plannotator from the pi TUI, or launch/connect a pi session that is already in plan mode (for example via the Plannotator --plan flag). Once the agent calls plannotator_submit_plan, the dashboard will show the review link/waiting card.";

function emitFeedback(
  sink: FeedbackSink | undefined,
  sessionId: string,
  command: string,
  status: "started" | "completed" | "error",
  message?: string,
): void {
  if (!sink) return;
  sink({
    type: "event_forward",
    sessionId,
    event: {
      eventType: "command_feedback",
      timestamp: Date.now(),
      data: message === undefined ? { command, status } : { command, status, message },
    },
  });
}

function parseSlash(text: string): { command: string; args: string } | null {
  if (!text.startsWith("/") || text.includes("\n")) return null;
  const rest = text.slice(1);
  const spaceIdx = rest.indexOf(" ");
  const command = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
  if (!command) return null;
  return { command, args: spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1) };
}

function findCommand(
  text: string,
  commands: Array<{ name: string; source?: string; handler?: (args: string, ctx: any) => unknown }>,
): { command: string; args: string; entry: { name: string; source?: string; handler?: (args: string, ctx: any) => unknown } } | null {
  const parsed = parseSlash(text);
  if (!parsed) return null;
  const entry = commands.find((c) => c?.name === parsed.command);
  return entry ? { ...parsed, entry } : null;
}

/**
 * Try to dispatch a slash command as an extension command.
 *
 * @returns `true` if the helper handled the text (extension command detected;
 *          dispatch attempted or stopgap emitted). The caller MUST NOT fall
 *          through to template expansion or `sendUserMessage`.
 * @returns `false` if `text` is not an extension slash command. The caller
 *          SHOULD continue with its existing fallback path.
 */
export async function tryDispatchExtensionCommand(
  pi: unknown,
  text: string,
  sessionId: string,
  sink: FeedbackSink | undefined,
  ctx?: unknown,
): Promise<boolean> {
  // Defensive: pi.getCommands() can throw on a stale ctx during dispose.
  let commands: Array<{ name: string; source?: string }> = [];
  try {
    const got = (pi as any)?.getCommands?.();
    if (Array.isArray(got)) commands = got;
  } catch (err) {
    console.warn("[dashboard] getCommands stale on slash-dispatch", err);
    return false; // fall through to existing path; preserve today's behavior
  }

  const match = findCommand(text, commands as any);
  if (!match || !isExtensionSlashCommand(text, commands)) return false;

  emitFeedback(sink, sessionId, text, "started");

  const handler = match.entry.handler;
  if (typeof handler === "function") {
    try {
      await handler(match.args, ctx);
      emitFeedback(sink, sessionId, text, "completed");
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      emitFeedback(sink, sessionId, text, "error", message);
    }
    return true;
  }

  // Stopgap when pi exposes only metadata for extension commands.
  emitFeedback(sink, sessionId, text, "error", match.command.startsWith("plannotator") ? PLANNOTATOR_UNSUPPORTED : COMMAND_UNSUPPORTED);
  return true;
}
