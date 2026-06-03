import React from "react";

type DiffLineKind = "add" | "remove" | "hunk" | "meta" | "context";

interface ToolDiffTextViewProps {
  diff: string;
  maxHeight?: string;
}

function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "remove";
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("---") ||
    line.startsWith("+++") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ")
  ) {
    return "meta";
  }
  return "context";
}

function classForKind(kind: DiffLineKind): string {
  switch (kind) {
    case "add":
      return "text-[var(--accent-green)] bg-[color-mix(in_srgb,var(--accent-green)_15%,transparent)]";
    case "remove":
      return "text-[var(--accent-red)] bg-[color-mix(in_srgb,var(--accent-red)_15%,transparent)]";
    case "hunk":
      return "text-[var(--accent-blue)] bg-[color-mix(in_srgb,var(--accent-blue)_15%,transparent)]";
    case "meta":
      return "text-[var(--text-tertiary)] font-bold";
    case "context":
      return "text-[var(--text-secondary)]";
  }
}

/** Render display-oriented tool diffs, including pi edit/hashline diff output. */
export function ToolDiffTextView({ diff, maxHeight }: ToolDiffTextViewProps) {
  const lines = diff.replace(/\r/g, "").split("\n");
  const style: React.CSSProperties = maxHeight ? { maxHeight, overflowY: "auto" } : {};

  return (
    <div
      data-testid="tool-diff-text"
      className="font-mono text-xs leading-relaxed overflow-auto"
      style={style}
    >
      {lines.map((line, i) => (
        <div key={i} className={`px-2 whitespace-pre ${classForKind(classifyDiffLine(line))}`}>
          {line || "\u00A0"}
        </div>
      ))}
    </div>
  );
}
