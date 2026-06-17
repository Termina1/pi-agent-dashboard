import React, { useMemo } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { getSyntaxTheme } from "../lib/syntax-theme.js";
import { useThemeContext } from "./ThemeProvider.js";
import { detectLanguage } from "./tool-renderers/lang-detect.js";

type DiffLineKind = "add" | "remove" | "hunk" | "meta" | "context";
type SyntaxStyle = ReturnType<typeof getSyntaxTheme>;

type ParsedDiffLine = {
  kind: DiffLineKind;
  marker: "+" | "-" | " ";
  oldLine?: string;
  newLine?: string;
  content: string;
  raw: string;
};

interface ParsedDiff {
  lines: ParsedDiffLine[];
  stats: { added: number; removed: number };
}

interface ToolDiffTextViewProps {
  diff: string;
  maxHeight?: string;
  filePath?: string;
}

const HUNK_HEADER_PATTERN = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/;
const HASHLINE_ANCHOR_LINE_PATTERN = /^([+\- ])(\s*\d+)#([A-Za-z0-9]+| {2}):(.*)$/;
const CANONICAL_LINE_PATTERN = /^([+\- ])(\s*\d+)\|(.*)$/;
const HASHLINE_NO_HASH_LINE_PATTERN = /^([+\- ])(\s*\d+) {4}(.*)$/;
const LEGACY_DISPLAY_LINE_PATTERN = /^([+\- ])(\s*\d+)\s(.*)$/;

function isMetaLine(line: string): boolean {
  return (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("---") ||
    line.startsWith("+++") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("\\ No newline")
  );
}

function kindFromMarker(marker: string): DiffLineKind {
  if (marker === "+") return "add";
  if (marker === "-") return "remove";
  return "context";
}

function markerFromKind(kind: DiffLineKind): "+" | "-" | " " {
  if (kind === "add") return "+";
  if (kind === "remove") return "-";
  return " ";
}

function buildDisplayLine(marker: string, lineNumber: string, content: string, hash?: string): ParsedDiffLine {
  const kind = kindFromMarker(marker);
  const number = lineNumber.trim();
  const hashSuffix = hash && hash.trim() ? `#${hash.trim()}` : "";
  return {
    kind,
    marker: markerFromKind(kind),
    oldLine: kind === "add" ? undefined : number,
    newLine: kind === "remove" ? undefined : number,
    content,
    raw: `${marker}${lineNumber}${hashSuffix ? `#${hash}` : ""}${hash ? ":" : " "}${content}`,
  };
}

function parseDisplayLine(line: string): ParsedDiffLine | null {
  const hashline = line.match(HASHLINE_ANCHOR_LINE_PATTERN);
  if (hashline) {
    return buildDisplayLine(hashline[1] ?? " ", hashline[2] ?? "", hashline[4] ?? "", hashline[3]);
  }

  const canonical = line.match(CANONICAL_LINE_PATTERN);
  if (canonical) {
    return buildDisplayLine(canonical[1] ?? " ", canonical[2] ?? "", canonical[3] ?? "");
  }

  const noHash = line.match(HASHLINE_NO_HASH_LINE_PATTERN);
  if (noHash) {
    return buildDisplayLine(noHash[1] ?? " ", noHash[2] ?? "", noHash[3] ?? "");
  }

  const legacy = line.match(LEGACY_DISPLAY_LINE_PATTERN);
  if (legacy) {
    return buildDisplayLine(legacy[1] ?? " ", legacy[2] ?? "", legacy[3] ?? "");
  }

  return null;
}

function parseToolDiff(diff: string): ParsedDiff {
  const parsed: ParsedDiffLine[] = [];
  const stats = { added: 0, removed: 0 };
  let oldCursor: number | null = null;
  let newCursor: number | null = null;

  for (const raw of diff.replace(/\r/g, "").split("\n")) {
    const hunk = raw.match(HUNK_HEADER_PATTERN);
    if (hunk) {
      oldCursor = Number.parseInt(hunk[1] ?? "", 10);
      newCursor = Number.parseInt(hunk[2] ?? "", 10);
      parsed.push({ kind: "hunk", marker: " ", content: raw, raw });
      continue;
    }

    if (isMetaLine(raw)) {
      parsed.push({ kind: "meta", marker: " ", content: raw, raw });
      continue;
    }

    const displayLine = parseDisplayLine(raw);
    if (displayLine) {
      if (displayLine.kind === "add") stats.added++;
      if (displayLine.kind === "remove") stats.removed++;
      parsed.push(displayLine);
      continue;
    }

    const marker = raw.startsWith("+") ? "+" : raw.startsWith("-") ? "-" : " ";
    const kind = kindFromMarker(marker);
    const content = raw.startsWith("+") || raw.startsWith("-") || raw.startsWith(" ")
      ? raw.slice(1)
      : raw;
    const oldLine = kind !== "add" && oldCursor !== null ? String(oldCursor) : undefined;
    const newLine = kind !== "remove" && newCursor !== null ? String(newCursor) : undefined;

    if (kind === "add") {
      stats.added++;
      if (newCursor !== null) newCursor++;
    } else if (kind === "remove") {
      stats.removed++;
      if (oldCursor !== null) oldCursor++;
    } else {
      if (oldCursor !== null) oldCursor++;
      if (newCursor !== null) newCursor++;
    }

    parsed.push({ kind, marker: markerFromKind(kind), oldLine, newLine, content, raw });
  }

  return { lines: parsed, stats };
}

function normalizeDiffFilePath(rawPath: string): string | undefined {
  const path = rawPath.trim();
  if (!path || path === "/dev/null") return undefined;
  return path.replace(/^[ab]\//, "");
}

function inferFilePathFromDiff(diff: string): string | undefined {
  for (const raw of diff.replace(/\r/g, "").split("\n")) {
    if (raw.startsWith("+++ ")) {
      return normalizeDiffFilePath(raw.slice(4));
    }
  }
  for (const raw of diff.replace(/\r/g, "").split("\n")) {
    if (raw.startsWith("--- ")) {
      return normalizeDiffFilePath(raw.slice(4));
    }
  }
  return undefined;
}

function rowClass(kind: DiffLineKind): string {
  switch (kind) {
    case "add":
      return "border-l-[var(--accent-green)] bg-[color-mix(in_srgb,var(--accent-green)_12%,transparent)]";
    case "remove":
      return "border-l-[var(--accent-red)] bg-[color-mix(in_srgb,var(--accent-red)_12%,transparent)]";
    case "hunk":
      return "border-l-[var(--accent-blue)] bg-[color-mix(in_srgb,var(--accent-blue)_14%,transparent)] text-[var(--accent-blue)]";
    case "meta":
      return "border-l-transparent text-[var(--text-tertiary)] bg-[var(--bg-secondary)]/60";
    case "context":
      return "border-l-transparent text-[var(--text-secondary)]";
  }
}

function markerClass(kind: DiffLineKind): string {
  if (kind === "add") return "text-[var(--accent-green)]";
  if (kind === "remove") return "text-[var(--accent-red)]";
  if (kind === "hunk") return "text-[var(--accent-blue)]";
  return "text-[var(--text-muted)]";
}

function lineNumberForDisplay(line: ParsedDiffLine): string {
  if (line.kind === "add") return line.newLine ?? "";
  if (line.kind === "remove") return line.oldLine ?? "";
  if (line.kind === "context") return line.oldLine ?? line.newLine ?? "";
  return "";
}

const rowGridStyle: React.CSSProperties = {
  gridTemplateColumns: "minmax(3rem,max-content) 1rem minmax(0,1fr)",
};

function HighlightedDiffContent({ code, language, syntaxStyle }: { code: string; language?: string; syntaxStyle: SyntaxStyle }) {
  if (!language) return <>{code || "\u00A0"}</>;

  return (
    <SyntaxHighlighter
      style={syntaxStyle}
      language={language}
      PreTag="span"
      CodeTag="span"
      customStyle={{ margin: 0, padding: 0, background: "transparent", display: "inline" }}
      codeTagProps={{ style: { fontFamily: "inherit", whiteSpace: "pre", background: "transparent" } }}
    >
      {code || " "}
    </SyntaxHighlighter>
  );
}

/** Render display-oriented tool diffs, including pi edit/hashline diff output. */
export function ToolDiffTextView({ diff, filePath, maxHeight }: ToolDiffTextViewProps) {
  const { resolved: theme, themeName } = useThemeContext();
  const parsed = useMemo(() => parseToolDiff(diff), [diff]);
  const inferredFilePath = useMemo(() => filePath ?? inferFilePathFromDiff(diff), [diff, filePath]);
  const language = useMemo(() => detectLanguage(inferredFilePath), [inferredFilePath]);
  const syntaxStyle = useMemo(() => getSyntaxTheme(theme, themeName), [theme, themeName]);
  const style: React.CSSProperties = maxHeight ? { maxHeight, overflowY: "auto" } : {};

  return (
    <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-code)] overflow-hidden">
      <div
        data-testid="tool-diff-summary"
        className="flex items-center gap-2 px-2 py-1 border-b border-[var(--border-subtle)] text-[11px] bg-[var(--bg-secondary)]/70"
      >
        <span className="font-medium text-[var(--text-secondary)]">diff</span>
        <span className="text-[var(--accent-green)]">+{parsed.stats.added}</span>
        <span className="text-[var(--accent-red)]">-{parsed.stats.removed}</span>
      </div>
      <div
        data-testid="tool-diff-text"
        className="font-mono text-xs leading-relaxed overflow-auto"
        style={style}
      >
        {parsed.lines.map((line, i) => (
          <div
            key={i}
            data-testid="tool-diff-row"
            className={`grid min-w-max border-l-2 ${rowClass(line.kind)}`}
            style={rowGridStyle}
          >
            <span data-testid="tool-diff-line-number" className="px-2 text-right select-text text-[var(--text-muted)] border-r border-[var(--border-subtle)]/60">
              {lineNumberForDisplay(line)}
            </span>
            <span className={`px-1 text-center select-none ${markerClass(line.kind)}`}>
              {line.kind === "meta" || line.kind === "hunk" ? "" : line.marker}
            </span>
            <span className="px-2 whitespace-pre min-w-0">
              <HighlightedDiffContent
                code={line.content}
                language={line.kind === "meta" || line.kind === "hunk" ? undefined : language}
                syntaxStyle={syntaxStyle}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
