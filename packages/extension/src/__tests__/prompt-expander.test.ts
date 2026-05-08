import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expandPromptTemplateFromDisk } from "../prompt-expander.js";
import { parseSkillBlock } from "@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js";

const tmpDir = join(import.meta.dirname ?? __dirname, "__tmp_prompt_test__");
const promptsDir = join(tmpDir, ".pi", "prompts");
const skillsDir = join(tmpDir, ".pi", "skills");

beforeEach(() => {
  mkdirSync(promptsDir, { recursive: true });
  writeFileSync(join(promptsDir, "opsx-continue.md"), "---\ndescription: continue\n---\nContinue the change");
  writeFileSync(join(promptsDir, "opsx-apply.md"), "Apply the change");
  writeFileSync(join(promptsDir, "hello.md"), "Hello world");
  // Skill fixture
  mkdirSync(join(skillsDir, "my-skill"), { recursive: true });
  writeFileSync(
    join(skillsDir, "my-skill", "SKILL.md"),
    "---\nname: my-skill\ndescription: A demo skill\n---\nFirst body line\nSecond body line",
  );
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("expandPromptTemplateFromDisk", () => {
  it("expands hyphen form /opsx-continue", () => {
    const result = expandPromptTemplateFromDisk("/opsx-continue my-change", tmpDir);
    expect(result).toContain("Continue the change");
    expect(result).toContain("my-change");
  });

  it("expands colon form /opsx:continue as alias for /opsx-continue", () => {
    const result = expandPromptTemplateFromDisk("/opsx:continue my-change", tmpDir);
    expect(result).toContain("Continue the change");
    expect(result).toContain("my-change");
  });

  it("expands colon form /opsx:apply without args", () => {
    const result = expandPromptTemplateFromDisk("/opsx:apply", tmpDir);
    expect(result).toBe("Apply the change");
  });

  it("does not affect non-opsx colon commands", () => {
    // /hello has no colon, should work as before
    const result = expandPromptTemplateFromDisk("/hello", tmpDir);
    expect(result).toBe("Hello world");
  });

  it("returns original text when no template found", () => {
    const result = expandPromptTemplateFromDisk("/nonexistent", tmpDir);
    expect(result).toBe("/nonexistent");
  });

  it("strips YAML frontmatter from colon form too", () => {
    const result = expandPromptTemplateFromDisk("/opsx:continue", tmpDir);
    expect(result).toBe("Continue the change");
    expect(result).not.toContain("---");
  });

  // See change: render-skill-invocations-collapsibly.

  it("wraps /skill:my-skill output in a <skill> envelope (with args)", () => {
    const result = expandPromptTemplateFromDisk("/skill:my-skill do the thing", tmpDir);
    expect(result.startsWith('<skill name="my-skill" location="')).toBe(true);
    expect(result).toContain("References are relative to ");
    expect(result).toContain("First body line\nSecond body line");
    expect(result.endsWith("\n\ndo the thing")).toBe(true);
    // round-trips through parseSkillBlock
    const parsed = parseSkillBlock(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("my-skill");
    expect(parsed!.args).toBe("do the thing");
    expect(parsed!.condensed).toBe("/skill:my-skill do the thing");
  });

  it("wraps /skill:my-skill output in a <skill> envelope (without args)", () => {
    const result = expandPromptTemplateFromDisk("/skill:my-skill", tmpDir);
    expect(result.startsWith('<skill name="my-skill" location="')).toBe(true);
    expect(result.endsWith("</skill>")).toBe(true);
    expect(result).not.toContain("</skill>\n\n");
    const parsed = parseSkillBlock(result);
    expect(parsed!.args).toBeUndefined();
    expect(parsed!.condensed).toBe("/skill:my-skill");
  });

  it("prompt template /opsx-continue stays unwrapped (no <skill> tag)", () => {
    const result = expandPromptTemplateFromDisk("/opsx-continue my-change", tmpDir);
    expect(result).not.toContain("<skill name=");
    expect(result).not.toContain("</skill>");
  });

  it("colon-alias prompt template /opsx:continue stays unwrapped", () => {
    const result = expandPromptTemplateFromDisk("/opsx:continue x", tmpDir);
    expect(result).not.toContain("<skill name=");
  });
});
