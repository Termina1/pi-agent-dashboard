import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { NotifyRenderer } from "../interactive-renderers/NotifyRenderer.js";

describe("NotifyRenderer", () => {
  it("renders Plannotator review notifications with a usable link", () => {
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

    expect(container.textContent).toContain("[Plannotator]");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/plannotator/");
  });
});
