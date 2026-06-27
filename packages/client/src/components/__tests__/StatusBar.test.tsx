import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { StatusBar } from "../StatusBar.js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(() => cleanup());

const models: ModelInfo[] = [
  { provider: "anthropic", id: "claude-4" },
  { provider: "openai", id: "gpt-4.1" },
];

describe("StatusBar", () => {
  it("renders model selector with current model", () => {
    render(<StatusBar model="anthropic/claude-4" models={models} status="idle" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    expect(screen.getByTestId("model-selector-button").textContent).toContain("anthropic/claude-4");
  });

  it("shows working status when streaming", () => {
    render(<StatusBar model="anthropic/claude-4" models={models} status="streaming" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    expect(screen.getByTestId("working-status")).toBeTruthy();
    expect(screen.getByTestId("working-status").textContent).toContain("Thinking");
  });

  it("shows tool name when running tool", () => {
    render(<StatusBar model="anthropic/claude-4" models={models} status="streaming" currentTool="bash" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    expect(screen.getByTestId("working-status").textContent).toContain("bash");
  });

  it("hides working status when idle", () => {
    render(<StatusBar model="anthropic/claude-4" models={models} status="idle" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    expect(screen.queryByTestId("working-status")).toBeNull();
  });

  it("renders Plannotator status in the same wrapping bar as model controls", () => {
    render(
      <StatusBar
        model="anthropic/claude-4"
        models={models}
        status="idle"
        onSelectModel={() => {}}
        onSelectThinkingLevel={() => {}}
        plannotator={{ available: true, phase: "planning", updatedAt: 1234 }}
      />,
    );

    const bar = screen.getByTestId("status-bar");
    expect(bar.className).toContain("flex-wrap");
    expect(screen.getByTestId("plannotator-mode-indicator").textContent).toContain("Plannotator ON");
  });

  it("shows unavailable instead of an endless checking state before bridge status arrives", () => {
    render(<StatusBar model="anthropic/claude-4" models={models} status="idle" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);

    const text = screen.getByTestId("plannotator-mode-indicator").textContent ?? "";
    expect(text).toContain("status unavailable");
    expect(text).toContain("waiting for bridge");
    expect(text).not.toContain("checking live state");
  });

  it("can hide the inline Plannotator pill for mobile layouts", () => {
    render(
      <StatusBar
        model="anthropic/claude-4"
        models={models}
        status="idle"
        onSelectModel={() => {}}
        onSelectThinkingLevel={() => {}}
        showPlannotator={false}
      />,
    );

    expect(screen.queryByTestId("plannotator-mode-indicator")).toBeNull();
  });
});

describe("ModelSelector", () => {
  it("opens dropdown on click", () => {
    render(<StatusBar model="anthropic/claude-4" models={models} status="idle" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    fireEvent.click(screen.getByTestId("model-selector-button"));
    expect(screen.getByTestId("model-dropdown")).toBeTruthy();
  });

  it("filters models", () => {
    render(<StatusBar model="anthropic/claude-4" models={models} status="idle" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    fireEvent.click(screen.getByTestId("model-selector-button"));
    const input = screen.getByTestId("model-filter");
    fireEvent.change(input, { target: { value: "gpt" } });
    // Should show gpt-4.1 but not claude-4
    const buttons = screen.getByTestId("model-dropdown").querySelectorAll("button");
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain("gpt-4.1");
  });

  it("calls onSelectModel when model clicked", () => {
    const onSelect = vi.fn();
    render(<StatusBar model="anthropic/claude-4" models={models} status="idle" onSelectModel={onSelect} onSelectThinkingLevel={() => {}} />);
    fireEvent.click(screen.getByTestId("model-selector-button"));
    const buttons = screen.getByTestId("model-dropdown").querySelectorAll("button");
    // Click second model (openai/gpt-4.1)
    fireEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith("openai/gpt-4.1");
  });

  it("is disabled when no models available", () => {
    render(<StatusBar model="anthropic/claude-4" status="idle" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    const btn = screen.getByTestId("model-selector-button");
    expect(btn.hasAttribute("disabled")).toBe(true);
  });
});

describe("ThinkingLevelSelector", () => {
  it("renders current thinking level", () => {
    render(<StatusBar model="anthropic/claude-4" models={models} thinkingLevel="high" status="idle" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    expect(screen.getByTestId("thinking-level-button").textContent).toContain("high");
  });

  it("shows 'off' when no thinking level set", () => {
    render(<StatusBar model="anthropic/claude-4" models={models} status="idle" onSelectModel={() => {}} onSelectThinkingLevel={() => {}} />);
    expect(screen.getByTestId("thinking-level-button").textContent).toContain("off");
  });

  it("opens dropdown and calls onSelectThinkingLevel", () => {
    const onSelect = vi.fn();
    render(<StatusBar model="anthropic/claude-4" models={models} status="idle" onSelectModel={() => {}} onSelectThinkingLevel={onSelect} />);
    fireEvent.click(screen.getByTestId("thinking-level-button"));
    expect(screen.getByTestId("thinking-level-dropdown")).toBeTruthy();
    const buttons = screen.getByTestId("thinking-level-dropdown").querySelectorAll("button");
    // Click "high" (index 4)
    fireEvent.click(buttons[4]);
    expect(onSelect).toHaveBeenCalledWith("high");
  });
});
