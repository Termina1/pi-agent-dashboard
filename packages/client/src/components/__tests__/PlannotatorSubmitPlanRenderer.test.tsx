import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { PlannotatorSubmitPlanRenderer } from "../tool-renderers/PlannotatorSubmitPlanRenderer.js";

describe("PlannotatorSubmitPlanRenderer", () => {
  it("always renders a same-origin session proxy link while review is running", () => {
    const { container } = render(
      <PlannotatorSubmitPlanRenderer
        toolName="plannotator_submit_plan"
        args={{ filePath: "PLAN.md" }}
        status="running"
        context={{ sessionId: "s1", editors: [] }}
      />,
    );

    const link = container.querySelector("a");
    expect(link?.textContent).toContain("Open Plannotator review");
    expect(link?.getAttribute("href")).toBe("/plannotator/s1/");
  });

  it("rewrites discovered localhost review URLs to the session proxy route", () => {
    const { container } = render(
      <PlannotatorSubmitPlanRenderer
        toolName="plannotator_submit_plan"
        args={{ filePath: "PLAN.md" }}
        status="running"
        result="Open http://localhost:23456/api/plan?x=1"
        context={{ sessionId: "s1", editors: [], plannotatorPort: 23456 }}
      />,
    );

    expect(container.querySelector("a")?.getAttribute("href")).toBe("/plannotator/s1/api/plan?x=1");
  });
});
