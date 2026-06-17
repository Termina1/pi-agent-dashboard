import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

afterEach(() => cleanup());

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

let mockIsMobile = false;
vi.mock("../../hooks/useMobile.js", () => ({
  useMobile: () => mockIsMobile,
  MobileProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock ImageLightbox so we can assert it mounts without pulling in its deps.
vi.mock("../ImageLightbox.js", () => ({
  ImageLightbox: ({ src, alt }: { src: string; alt: string }) => (
    <div data-testid="lightbox" data-src={src} data-alt={alt} />
  ),
}));

import { ShowImageToolRenderer } from "../tool-renderers/ShowImageToolRenderer.js";
import { SessionAssetsProvider } from "../../lib/SessionAssetsContext.js";
import type { SessionAssets } from "../../lib/SessionAssetsContext.js";
import type { ToolContext } from "../tool-renderers/types.js";

const ctx: ToolContext = { editors: [] };

function renderWith(assets: SessionAssets, props: Partial<Parameters<typeof ShowImageToolRenderer>[0]>) {
  return render(
    <SessionAssetsProvider assets={assets}>
      <ShowImageToolRenderer
        toolName="show_image"
        args={{ path: "/work/shot.png" }}
        status="complete"
        context={ctx}
        {...props}
      />
    </SessionAssetsProvider>,
  );
}

describe("ShowImageToolRenderer", () => {
  it("renders the image from the resolved asset + caption", () => {
    const assets: SessionAssets = {
      abc123: { mimeType: "image/png" },
    };
    const { getByRole, getByText } = renderWith(assets, {
      toolDetails: { hash: "abc123", caption: "A nice shot", path: "/work/shot.png" },
    });
    const img = getByRole("img");
    expect(img.getAttribute("src")).toBe(`${window.location.origin}/api/assets/abc123`);
    expect(img.getAttribute("alt")).toBe("shot.png");
    expect(getByText("A nice shot")).toBeTruthy();
  });

  it("uses explicit alt when provided", () => {
    const assets: SessionAssets = { h: { mimeType: "image/png" } };
    const { getByRole } = renderWith(assets, {
      toolDetails: { hash: "h", alt: "custom alt text" },
    });
    expect(getByRole("img").getAttribute("alt")).toBe("custom alt text");
  });

  it("opens the lightbox on click", () => {
    const assets: SessionAssets = { h: { mimeType: "image/png" } };
    const { getByRole, getByTestId } = renderWith(assets, {
      toolDetails: { hash: "h" },
    });
    fireEvent.click(getByRole("img"));
    const lb = getByTestId("lightbox");
    expect(lb.getAttribute("data-src")).toBe(`${window.location.origin}/api/assets/h`);
  });

  it("shows a loading state while the tool is running", () => {
    const { getByText } = renderWith({}, { status: "running" });
    expect(getByText(/Reading image/)).toBeTruthy();
  });

  it("shows a loading state when hash present but asset bytes not yet registered", () => {
    const { getByText } = renderWith({}, {
      toolDetails: { hash: "not-yet" },
    });
    expect(getByText(/Loading image/)).toBeTruthy();
  });

  it("renders the bridge error message when details.error is set", () => {
    const { getByText } = renderWith({}, {
      toolDetails: { error: "not_found", message: "image not found: nope.png" },
    });
    expect(getByText("image not found: nope.png")).toBeTruthy();
  });

  it("renders 'Image unavailable' when complete with no hash and no error", () => {
    const { getByText } = renderWith({}, {});
    expect(getByText("Image unavailable.")).toBeTruthy();
  });

  it("uses full-width class on mobile", () => {
    mockIsMobile = true;
    const assets: SessionAssets = { h: { mimeType: "image/png" } };
    const { getByRole } = renderWith(assets, { toolDetails: { hash: "h" } });
    expect(getByRole("img").className).toContain("w-full");
    mockIsMobile = false;
  });
});
