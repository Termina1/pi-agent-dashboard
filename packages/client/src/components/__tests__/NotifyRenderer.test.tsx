import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { NotifyRenderer } from "../interactive-renderers/NotifyRenderer.js";

describe("NotifyRenderer", () => {
  it("rewrites Plannotator localhost links to the dashboard proxy route", () => {
    const { container } = render(
      <NotifyRenderer
        requestId="n1"
        method="notify"
        params={{ message: "[Plannotator] http://localhost:19432" }}
        status="pending"
        onRespond={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(container.textContent).toContain("Plannotator review ready");
    expect(container.textContent).toContain("each time a plan is submitted");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/plannotator/");
    expect(link?.textContent).toBe("Open Plannotator review");
  });
});
