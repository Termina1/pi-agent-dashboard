/**
 * Seed a temporary dashboard HOME with fixture data.
 *
 * This is a minimal implementation: it creates the expected directory
 * structure under HOME/.pi/agent/sessions/ and writes one stub session
 * JSON per entry in fixtures/sessions.json so the dashboard's session
 * scanner finds them at startup.
 *
 * The real, rich fixture generator (full event logs, turn_end stats,
 * flow state, diffs) is a follow-up — see fixtures/README.md.
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";

export interface SessionFixture {
  id: string;
  cwd: string;
  name: string;
  createdAt: string;
  model: string;
  status: "running" | "idle" | "ended";
}

const HERE = new URL(".", import.meta.url).pathname;

function toSessionFilename(createdAt: string, id: string): string {
  return `${createdAt.replace(/:(?=\d{2}(?::\d{2}\.\d{3}Z$))/g, "-").replace(/\.(\d{3})Z$/, "-$1Z")}_${id}.jsonl`;
}

export async function seedHome(home: string): Promise<void> {
  const sessionsDir = join(home, ".pi", "agent", "sessions");
  await mkdir(sessionsDir, { recursive: true });

  const sessions: SessionFixture[] = JSON.parse(
    await readFile(join(HERE, "fixtures", "sessions.json"), "utf8"),
  );

  const originalHome = process.env.HOME;
  process.env.HOME = home;
  try {
    for (const s of sessions) {
      const dir = join(sessionsDir, s.id);
      await mkdir(dir, { recursive: true });

      const sessionFile = join(dir, toSessionFilename(s.createdAt, s.id));
      await writeFile(
        sessionFile,
        [
          JSON.stringify({ type: "session", id: s.id, cwd: s.cwd, timestamp: s.createdAt }),
          JSON.stringify({ type: "session_info", name: s.name }),
        ].join("\n") + "\n",
      );

      writeSessionMeta(sessionFile, {
        cwd: s.cwd,
        name: s.name,
        model: s.model,
        status: s.status === "running" ? "active" : s.status,
        startedAt: new Date(s.createdAt).getTime(),
        cachedAt: Date.now(),
      });
    }
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[seed] wrote ${sessions.length} fixture sessions into ${sessionsDir}`,
  );
}
