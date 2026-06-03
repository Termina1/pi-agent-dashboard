import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  SessionSnapshotChatImage,
  SessionSnapshotChatMessage,
  SessionSnapshotSource,
  SessionSnapshotTranscript,
  SessionSnapshotTurnStat,
  SessionTranscriptSnapshot,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { parseSkillBlock } from "@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js";
import { loadSessionEntries, type SessionEntry } from "./session-file-reader.js";

export const CURRENT_SNAPSHOT_SCHEMA_VERSION = 1;
export const CURRENT_SNAPSHOT_PROJECTOR_VERSION = 1;
const MAX_TURN_STATS = 50;

export interface SessionSnapshotStore {
  readOrBuild(sessionId: string, sessionFile: string, knownContextWindow?: number): Promise<SessionTranscriptSnapshot>;
}

export interface SessionSnapshotPrewarmJob {
  sessionId: string;
  sessionFile: string;
  contextWindow?: number;
  activityAt?: number;
}

export interface SessionSnapshotPrewarmQueue {
  enqueue(job: SessionSnapshotPrewarmJob): void;
  enqueueMany(jobs: SessionSnapshotPrewarmJob[]): void;
  onIdle(): Promise<void>;
}

export function getSessionSnapshotPath(sessionFile: string): string {
  return sessionFile.endsWith(".jsonl")
    ? `${sessionFile.slice(0, -".jsonl".length)}.snapshot.json`
    : `${sessionFile}.snapshot.json`;
}

export async function statSnapshotSource(sessionFile: string): Promise<SessionSnapshotSource> {
  const s = await stat(sessionFile);
  return { sessionFile, size: s.size, mtimeMs: s.mtimeMs };
}

async function assertProjectableSessionFile(sessionFile: string): Promise<void> {
  const raw = await readFile(sessionFile, "utf8");
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim().length > 0);
  if (!firstLine) throw new Error("empty_session_file");
  let header: unknown;
  try {
    header = JSON.parse(firstLine);
  } catch {
    throw new Error("invalid_session_header");
  }
  if (!header || typeof header !== "object" || (header as any).type !== "session" || typeof (header as any).id !== "string") {
    throw new Error("invalid_session_header");
  }
}

export function isSessionSnapshotFresh(
  snapshot: Pick<SessionTranscriptSnapshot, "schemaVersion" | "projectorVersion" | "source"> | null | undefined,
  source: SessionSnapshotSource,
): snapshot is SessionTranscriptSnapshot {
  if (!snapshot || typeof snapshot !== "object") return false;
  return snapshot.schemaVersion === CURRENT_SNAPSHOT_SCHEMA_VERSION
    && snapshot.projectorVersion === CURRENT_SNAPSHOT_PROJECTOR_VERSION
    && snapshot.source?.size === source.size
    && snapshot.source?.mtimeMs === source.mtimeMs;
}

export async function readSessionSnapshotIfFresh(sessionFile: string): Promise<SessionTranscriptSnapshot | null> {
  const source = await statSnapshotSource(sessionFile);
  let raw: string;
  try {
    raw = await readFile(getSessionSnapshotPath(sessionFile), "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  return isSessionSnapshotFresh(parsed as SessionTranscriptSnapshot, source)
    ? parsed as SessionTranscriptSnapshot
    : null;
}

export async function writeSessionSnapshot(snapshot: SessionTranscriptSnapshot): Promise<void> {
  const snapshotPath = getSessionSnapshotPath(snapshot.source.sessionFile);
  await mkdir(dirname(snapshotPath), { recursive: true });
  const tmpPath = `${snapshotPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(snapshot)}\n`, "utf8");
  await rename(tmpPath, snapshotPath);
}

export async function buildSessionSnapshotFromFile(
  sessionId: string,
  sessionFile: string,
  knownContextWindow?: number,
): Promise<SessionTranscriptSnapshot> {
  const source = await statSnapshotSource(sessionFile);
  await assertProjectableSessionFile(sessionFile);
  const entries = loadSessionEntries(sessionFile);
  return {
    schemaVersion: CURRENT_SNAPSHOT_SCHEMA_VERSION,
    projectorVersion: CURRENT_SNAPSHOT_PROJECTOR_VERSION,
    source,
    builtAt: Date.now(),
    transcript: projectEntriesToTranscript(sessionId, entries, knownContextWindow),
  };
}

export async function readOrBuildSessionSnapshot(
  sessionId: string,
  sessionFile: string,
  knownContextWindow?: number,
): Promise<SessionTranscriptSnapshot> {
  const existing = await readSessionSnapshotIfFresh(sessionFile);
  if (existing) return existing;
  const snapshot = await buildSessionSnapshotFromFile(sessionId, sessionFile, knownContextWindow);
  await writeSessionSnapshot(snapshot);
  return snapshot;
}

export const defaultSessionSnapshotStore: SessionSnapshotStore = {
  readOrBuild: readOrBuildSessionSnapshot,
};

function emptyTranscript(): SessionSnapshotTranscript {
  return {
    messages: [],
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    hasFileChanges: false,
    turnStats: [],
    turnCount: 0,
  };
}

function entryTimestamp(entry: SessionEntry): number {
  return typeof entry.timestamp === "string" ? new Date(entry.timestamp).getTime() : Date.now();
}

function textFromContent(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text)
      .join("");
  }
  return String(content ?? "");
}

function imagesFromContent(content: unknown): SessionSnapshotChatImage[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const images = content
    .filter((c: any) => c?.type === "image" && typeof c.data === "string" && typeof c.mimeType === "string")
    .map((c: any) => ({ data: c.data as string, mimeType: c.mimeType as string }));
  return images.length > 0 ? images : undefined;
}

function parseToolArgs(args: unknown): Record<string, unknown> | undefined {
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : undefined;
}

function contentBlockText(blocks: unknown[]): string | null {
  const texts = blocks
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text);
  return texts.length > 0 ? texts.join("\n") : null;
}

function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return contentBlockText(value) ?? JSON.stringify(value, null, 2);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.content)) return contentBlockText(obj.content) ?? JSON.stringify(value, null, 2);
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function truncateLines(value: unknown, maxLines: number): string {
  const text = toDisplayString(value);
  const lines = text.split("\n");
  return lines.length <= maxLines ? text : lines.slice(0, maxLines).join("\n");
}

function addToolStart(
  transcript: SessionSnapshotTranscript,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown> | undefined,
  timestamp: number,
): void {
  const toolLower = toolName.toLowerCase();
  if (toolLower === "write" || toolLower === "edit") transcript.hasFileChanges = true;

  const existingIdx = transcript.messages.findLastIndex((m) => m.role === "toolResult" && m.toolCallId === toolCallId);
  if (existingIdx !== -1) {
    transcript.messages[existingIdx] = { ...transcript.messages[existingIdx], toolName, args };
    return;
  }

  transcript.messages.push({
    id: `tool-${toolCallId}`,
    role: "toolResult",
    content: toolName,
    toolName,
    toolCallId,
    args,
    toolStatus: "running",
    timestamp,
    startedAt: timestamp,
  });
}

function addAssistantMessage(transcript: SessionSnapshotTranscript, content: unknown, timestamp: number, entryId?: string): void {
  const text = textFromContent(content);
  const blocks = Array.isArray(content) ? content : [];
  let assistantInserted = false;
  let pushedTool = false;

  if (blocks.length > 0) {
    for (const block of blocks) {
      if (block?.type === "text" && !assistantInserted && text) {
        transcript.messages.push({
          id: `msg-${transcript.messages.length}`,
          role: "assistant",
          content: text,
          timestamp,
          entryId,
        });
        assistantInserted = true;
      } else if (block?.type === "toolCall" && typeof block.id === "string") {
        addToolStart(
          transcript,
          block.id,
          typeof block.name === "string" ? block.name : "unknown",
          parseToolArgs(block.arguments),
          timestamp,
        );
        pushedTool = true;
      }
    }
  } else if (text) {
    transcript.messages.push({
      id: `msg-${transcript.messages.length}`,
      role: "assistant",
      content: text,
      timestamp,
      entryId,
    });
    assistantInserted = true;
  }

  if (!assistantInserted && text) {
    transcript.messages.push({
      id: `msg-${transcript.messages.length}`,
      role: "assistant",
      content: text,
      timestamp,
      entryId,
    });
  } else if (!text && pushedTool && transcript.messages[transcript.messages.length - 1]?.role === "toolResult") {
    transcript.messages.push({
      id: `sep-${transcript.messages.length}`,
      role: "turnSeparator",
      content: "",
      timestamp,
    });
  }
}

function applyToolResult(transcript: SessionSnapshotTranscript, msg: any, timestamp: number, entryId?: string): void {
  const toolCallId = String(msg.toolCallId ?? "");
  if (!toolCallId) return;
  const toolName = typeof msg.toolName === "string" ? msg.toolName : "unknown";
  const idx = transcript.messages.findLastIndex((m) => m.role === "toolResult" && m.toolCallId === toolCallId);
  if (idx === -1) {
    addToolStart(transcript, toolCallId, toolName, undefined, timestamp);
  }
  const targetIdx = transcript.messages.findLastIndex((m) => m.role === "toolResult" && m.toolCallId === toolCallId);
  if (targetIdx === -1) return;

  const existing = transcript.messages[targetIdx];
  const startedAt = existing.startedAt;
  const images = imagesFromContent(msg.content);
  const details = msg.details && typeof msg.details === "object" && !Array.isArray(msg.details)
    ? msg.details as Record<string, unknown>
    : undefined;
  transcript.messages[targetIdx] = {
    ...existing,
    toolName,
    content: toolName,
    toolStatus: msg.isError ? "error" : "complete",
    result: truncateLines(msg.content, 30),
    duration: startedAt ? timestamp - startedAt : undefined,
    entryId,
    ...(images ? { images } : {}),
    ...(details ? { toolDetails: details } : {}),
  };
}

function applyUsage(
  transcript: SessionSnapshotTranscript,
  usage: Record<string, unknown> | undefined,
  model: string | undefined,
  knownContextWindow?: number,
): void {
  if (!usage) return;
  const input = typeof usage.input === "number" ? usage.input : 0;
  const output = typeof usage.output === "number" ? usage.output : 0;
  const cacheRead = typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
  const cacheWrite = typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;
  const costRaw = usage.cost;
  const cost = typeof costRaw === "number"
    ? costRaw
    : costRaw && typeof costRaw === "object" && typeof (costRaw as any).total === "number"
      ? (costRaw as any).total
      : 0;

  transcript.tokensIn += input;
  transcript.tokensOut += output;
  transcript.cacheRead += cacheRead;
  transcript.cacheWrite += cacheWrite;
  transcript.cost += cost;

  const lastUserIdx = transcript.messages.findLastIndex((m) => m.role === "user");
  let assignedTurnIndex = -1;
  if (lastUserIdx !== -1 && transcript.messages[lastUserIdx].turnIndex === undefined) {
    assignedTurnIndex = transcript.turnCount;
    transcript.messages[lastUserIdx] = { ...transcript.messages[lastUserIdx], turnIndex: transcript.turnCount };
    transcript.turnCount += 1;
  }

  const turnStat: SessionSnapshotTurnStat = { input, output, cacheRead, cacheWrite, turnIndex: assignedTurnIndex };
  transcript.turnStats = [...transcript.turnStats, turnStat].slice(-MAX_TURN_STATS);

  const totalTokens = typeof usage.totalTokens === "number" ? usage.totalTokens : undefined;
  if (totalTokens && totalTokens > 0) {
    transcript.contextUsage = {
      tokens: totalTokens,
      contextWindow: knownContextWindow ?? inferContextWindow(model),
    };
  }
}

export function projectEntriesToTranscript(
  _sessionId: string,
  entries: SessionEntry[],
  knownContextWindow?: number,
): SessionSnapshotTranscript {
  const transcript = emptyTranscript();
  const openToolCalls = new Set<string>();
  let currentModel: string | undefined;

  for (const entry of entries) {
    const timestamp = entryTimestamp(entry);

    if (entry.type === "model_change") {
      const provider = typeof entry.provider === "string" ? entry.provider : undefined;
      const modelId = typeof entry.modelId === "string" ? entry.modelId : undefined;
      currentModel = provider && modelId ? `${provider}/${modelId}` : modelId;
      if (currentModel) transcript.model = currentModel;
      if (typeof entry.thinkingLevel === "string") transcript.thinkingLevel = entry.thinkingLevel;
      continue;
    }

    if (entry.type !== "message" || !entry.message) continue;
    const msg: any = entry.message;

    if (msg.role === "user") {
      const text = textFromContent(msg.content);
      const skill = parseSkillBlock(text) ?? undefined;
      transcript.messages.push({
        id: `msg-${transcript.messages.length}`,
        role: "user",
        content: text,
        timestamp,
        entryId: entry.id,
        ...(skill ? { skill } : {}),
        ...(imagesFromContent(msg.content) ? { images: imagesFromContent(msg.content) } : {}),
      });
      continue;
    }

    if (msg.role === "assistant") {
      const beforeToolIds = new Set(
        transcript.messages
          .filter((m) => m.role === "toolResult" && m.toolCallId)
          .map((m) => m.toolCallId!),
      );
      addAssistantMessage(transcript, msg.content, timestamp, entry.id);
      for (const m of transcript.messages) {
        if (m.role === "toolResult" && m.toolCallId && !beforeToolIds.has(m.toolCallId)) {
          openToolCalls.add(m.toolCallId);
        }
      }
      applyUsage(transcript, msg.usage as Record<string, unknown> | undefined, currentModel, knownContextWindow);
      continue;
    }

    if (msg.role === "toolResult") {
      applyToolResult(transcript, msg, timestamp, entry.id);
      if (typeof msg.toolCallId === "string") openToolCalls.delete(msg.toolCallId);
    }
  }

  for (const toolCallId of openToolCalls) {
    const idx = transcript.messages.findLastIndex((m) => m.role === "toolResult" && m.toolCallId === toolCallId);
    if (idx !== -1 && transcript.messages[idx].toolStatus === "running") {
      transcript.messages[idx] = { ...transcript.messages[idx], toolStatus: "complete", result: "" };
    }
  }

  return transcript;
}

function inferContextWindow(model: string | undefined): number {
  const id = (model ?? "").toLowerCase();
  if (id.includes("claude") && (id.includes("opus") || id.includes("sonnet") || id.includes("haiku"))) return 200_000;
  if (id.includes("gpt-4o")) return 128_000;
  if (id.includes("gpt-4")) return 128_000;
  if (id.includes("o1") || id.includes("o3") || id.includes("o4")) return 200_000;
  if (id.includes("gemini")) return 1_000_000;
  if (id.includes("deepseek")) return 128_000;
  return 200_000;
}

export function createSessionSnapshotPrewarmQueue(options: {
  concurrency?: number;
  build?: (job: SessionSnapshotPrewarmJob) => Promise<unknown>;
} = {}): SessionSnapshotPrewarmQueue {
  const concurrency = Math.max(1, options.concurrency ?? 1);
  const build = options.build ?? ((job: SessionSnapshotPrewarmJob) => readOrBuildSessionSnapshot(job.sessionId, job.sessionFile, job.contextWindow));
  let pending: SessionSnapshotPrewarmJob[] = [];
  let inFlight = 0;
  let scheduled = false;
  const idleWaiters: Array<() => void> = [];

  function sortPending(): void {
    pending.sort((a, b) => (b.activityAt ?? 0) - (a.activityAt ?? 0));
  }

  function resolveIdleIfNeeded(): void {
    if (pending.length > 0 || inFlight > 0) return;
    while (idleWaiters.length > 0) idleWaiters.shift()?.();
  }

  function pump(): void {
    scheduled = false;
    while (inFlight < concurrency && pending.length > 0) {
      const job = pending.shift()!;
      inFlight += 1;
      Promise.resolve(build(job))
        .catch((err) => {
          console.error(`[dashboard] snapshot prewarm failed for ${job.sessionId}:`, err);
        })
        .finally(() => {
          inFlight -= 1;
          if (pending.length > 0) schedule();
          resolveIdleIfNeeded();
        });
    }
    resolveIdleIfNeeded();
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(pump);
  }

  function enqueue(job: SessionSnapshotPrewarmJob): void {
    const key = `${job.sessionId}\0${job.sessionFile}`;
    pending = pending.filter((existing) => `${existing.sessionId}\0${existing.sessionFile}` !== key);
    pending.push(job);
    sortPending();
    schedule();
  }

  return {
    enqueue,
    enqueueMany(jobs) {
      for (const job of [...jobs].sort((a, b) => (b.activityAt ?? 0) - (a.activityAt ?? 0))) {
        enqueue(job);
      }
    },
    onIdle() {
      if (pending.length === 0 && inFlight === 0) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
  };
}
