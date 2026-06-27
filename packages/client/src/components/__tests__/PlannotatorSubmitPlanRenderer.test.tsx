import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { PlannotatorSubmitPlanRenderer } from "../tool-renderers/PlannotatorSubmitPlanRenderer.js";

describe("PlannotatorSubmitPlanRenderer", () => {
  it("always renders a same-origin proxy link while review is running", () => {
    const { container } = render(
      <PlannotatorSubmitPlanRenderer
        toolName="plannotator_submit_plan"
        args={{ filePath: "PLAN.md" }}
        status="running"
        context={{ editors: [] }}
      />,
    );

    const link = container.querySelector("a");
    expect(link?.textContent).toContain("Open Plannotator review");
    expect(link?.getAttribute("href")).toBe("/plannotator/");
  });

  it("rewrites discovered localhost review URLs to the proxy route", () => {
    const { container } = render(
      <PlannotatorSubmitPlanRenderer
        toolName="plannotator_submit_plan"
        args={{ filePath: "PLAN.md" }}
        status="running"
        result="Open http://localhost:19432/api/plan?x=1"
        context={{ editors: [] }}
      />,
    );

    expect(container.querySelector("a")?.getAttribute("href")).toBe("/plannotator/api/plan?x=1");
  });
});
