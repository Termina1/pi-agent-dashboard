import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("react-syntax-highlighter", () => ({
  Prism: ({ children, language }: { children: React.ReactNode; language?: string }) => (
    <span data-testid="syntax-highlighter" data-language={language}>{children}</span>
  ),
}));

vi.mock("../ThemeProvider.js", () => ({
  useThemeContext: () => ({ resolved: "dark", themeName: "base" }),
}));
import { ToolDiffTextView } from "../ToolDiffTextView.js";

afterEach(() => cleanup());

describe("ToolDiffTextView", () => {
  it("hides hashline hashes in line gutters", () => {
    const { getByTestId, getAllByTestId } = render(
      <ToolDiffTextView diff={'-1    const a = 1;\n+1#WXYZ:const a = 2;'} />,
    );

    expect(getByTestId("tool-diff-summary").textContent).toContain("+1");
    expect(getByTestId("tool-diff-summary").textContent).toContain("-1");
    expect(getAllByTestId("tool-diff-line-number").map((el) => el.textContent)).toEqual(["1", "1"]);
    expect(getByTestId("tool-diff-text").textContent).toContain("const a = 2;");
    expect(getByTestId("tool-diff-text").textContent).not.toContain("WXYZ");
  });

  it("derives line gutters from unified hunk headers", () => {
    const { getAllByTestId } = render(
      <ToolDiffTextView diff={'--- a/demo.ts\n+++ b/demo.ts\n@@ -10,2 +10,2 @@\n keep\n-old\n+new'} />,
    );

    const lineNumbers = getAllByTestId("tool-diff-line-number").map((el) => el.textContent);
    expect(lineNumbers).toContain("10");
    expect(lineNumbers).toContain("11");
  });

  it("syntax-highlights code rows using filePath language", () => {
    const { getAllByTestId } = render(
      <ToolDiffTextView filePath="demo.ts" diff={'-1    const a = 1;\n+1#WXYZ:const a = 2;'} />,
    );

    expect(getAllByTestId("syntax-highlighter").map((el) => el.getAttribute("data-language"))).toEqual([
      "typescript",
      "typescript",
    ]);
  });

  it("infers syntax language from unified diff headers", () => {
    const { getAllByTestId } = render(
      <ToolDiffTextView diff={'--- a/demo.py\n+++ b/demo.py\n@@ -1 +1 @@\n-print(1)\n+print(2)'} />,
    );

    expect(getAllByTestId("syntax-highlighter").map((el) => el.getAttribute("data-language"))).toEqual([
      "python",
      "python",
    ]);
  });
});
