/**
 * Expand prompt templates from disk for slash commands sent via the dashboard.
 *
 * pi.sendUserMessage() calls session.prompt() with expandPromptTemplates: false,
 * which skips prompt template and skill expansion. This module provides a workaround
 * by reading template/skill files directly and expanding them.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readdirSync, statSync } from "node:fs";
import { buildSkillBlock } from "@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js";

/** Scan directories for .md prompt template files */
function findPromptTemplates(cwd: string): Map<string, string> {
  const templates = new Map<string, string>();
  const dirs = [
    join(cwd, ".pi", "prompts"),
    join(cwd, ".pi", "skills"),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      scanDir(dir, templates);
    } catch { /* ignore */ }
  }
  return templates;
}

function scanDir(dir: string, templates: Map<string, string>): void {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        // Check for SKILL.md inside directory
        const skillFile = join(fullPath, "SKILL.md");
        if (existsSync(skillFile)) {
          templates.set(`skill:${entry}`, skillFile);
        }
      } else if (entry.endsWith(".md")) {
        const name = entry.replace(/\.md$/, "");
        templates.set(name, fullPath);
      }
    } catch { /* ignore */ }
  }
}

/** Read template content, stripping YAML frontmatter */
function readTemplate(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  // Strip YAML frontmatter (---\n...\n---)
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1].trim() : content.trim();
}

/**
 * Expand a slash command by finding and reading the prompt template from disk.
 * Returns the expanded text, or the original text if no template found.
 *
 * @param pi Optional pi extension API — used to find globally installed skills
 *           and package skills via pi.getCommands() when local scan misses them.
 */
export function expandPromptTemplateFromDisk(text: string, cwd: string, pi?: any): string {
  if (!text.startsWith("/")) return text;

  // Split template name from args on first whitespace (space OR newline).
  // Using indexOf(" ") alone breaks multi-line payloads like "/skill:foo\nargs"
  // because the first space can lie inside the args, producing a name such as
  // "skill:foo\nargs-first-word" that never matches a template.
  const m = text.slice(1).match(/^(\S+)\s*([\s\S]*)$/);
  const templateName = m?.[1] ?? text.slice(1);
  const argsString = m?.[2] ?? "";

  const templates = findPromptTemplates(cwd);
  let filePath = templates.get(templateName);

  // Support colon as alias for hyphen (e.g. /opsx:continue → opsx-continue)
  if (!filePath && templateName.includes(":")) {
    filePath = templates.get(templateName.replace(/:/g, "-"));
  }

  // Fallback: check pi.getCommands() for globally installed skills and package skills
  // that aren't in the local .pi/skills/ directory.
  if (!filePath && pi?.getCommands) {
    try {
      const commands = pi.getCommands();
      const skill = commands.find(
        (c: any) => c.name === templateName && c.source === "skill" && c.path,
      );
      if (skill?.path && existsSync(skill.path)) {
        filePath = skill.path;
      }
    } catch { /* ignore */ }
  }

  if (!filePath) return text;

  try {
    const content = readTemplate(filePath);

    // Skill detection: either the local-scan key starts with `skill:` or the
    // pi.getCommands() fallback resolved a command whose `source === "skill"`
    // (we re-check below). Skill expansions wrap in pi's `<skill>` envelope so
    // the dashboard ingress path is byte-identical to pi's own _expandSkillCommand,
    // which lets the client and server recover the slash-command form.
    // See change: render-skill-invocations-collapsibly.
    const isSkill = isSkillResolution(templateName, filePath, pi);
    if (isSkill) {
      const bareName = templateName.replace(/^skill:/, "");
      return buildSkillBlock({
        name: bareName,
        filePath,
        baseDir: dirname(filePath),
        body: content,
        userArgs: argsString || undefined,
      });
    }

    // Plain prompt templates: append args after a blank line, no wrapper.
    if (argsString) {
      return `${content}\n\n${argsString}`;
    }
    return content;
  } catch {
    return text;
  }
}

/**
 * Detect whether the resolved `filePath` came from a skill source.
 *
 * The local-scan key tells us directly when it starts with `skill:`. For the
 * pi.getCommands() fallback we re-query and check `source === "skill"` against
 * the same templateName.
 */
function isSkillResolution(
  templateName: string,
  filePath: string,
  pi: any | undefined,
): boolean {
  if (templateName.startsWith("skill:")) return true;
  // The colon-alias path (e.g. /opsx:continue) maps to a hyphen filename and is
  // a prompt template, not a skill. Skills always use the `skill:` prefix in
  // both the local scan and pi.getCommands().
  if (!pi?.getCommands) return false;
  try {
    const commands = pi.getCommands();
    const match = commands.find(
      (c: any) => c.name === templateName && c.source === "skill" && c.path === filePath,
    );
    return !!match;
  } catch {
    return false;
  }
}
