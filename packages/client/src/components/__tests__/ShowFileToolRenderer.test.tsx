import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

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

vi.mock("../ImageLightbox.js", () => ({
  ImageLightbox: ({ src, alt }: { src: string; alt: string }) => (
    <div data-testid="lightbox" data-src={src} data-alt={alt} />
  ),
}));

import { ShowFileToolRenderer } from "../tool-renderers/ShowFileToolRenderer.js";
import { SessionAssetsProvider } from "../../lib/SessionAssetsContext.js";
import type { SessionAssets } from "../../lib/SessionAssetsContext.js";
import type { ToolContext } from "../tool-renderers/types.js";

const ctx: ToolContext = { editors: [] };

function renderWith(assets: SessionAssets, props: Partial<Parameters<typeof ShowFileToolRenderer>[0]>) {
  return render(
    <SessionAssetsProvider assets={assets}>
      <ShowFileToolRenderer
        toolName="show_file"
        args={{ path: "/work/clip.mp3" }}
        status="complete"
        context={ctx}
        {...props}
      />
    </SessionAssetsProvider>,
  );
}

afterEach(() => cleanup());

describe("ShowFileToolRenderer", () => {
  it("renders an <audio> player for audio/* with an open link", () => {
    const assets: SessionAssets = { h: { mimeType: "audio/mpeg" } };
    const { container, getByRole, getByText } = renderWith(assets, {
      toolDetails: { hash: "h", mimeType: "audio/mpeg", size: 12345, filename: "clip.mp3" },
    });
    expect(container.querySelector("audio")).not.toBeNull();
    expect(container.querySelector("audio")?.getAttribute("src")).toBe(`${window.location.origin}/api/assets/h`);
    // open link present + size label
    const link = getByRole("link");
    expect(link.getAttribute("href")).toBe(`${window.location.origin}/api/assets/h`);
    expect(getByText(/clip\.mp3/)).toBeTruthy();
    expect(getByText(/12 KB/)).toBeTruthy();
  });

  it("renders a <video> player for video/*", () => {
    const assets: SessionAssets = { h: { mimeType: "video/mp4" } };
    const { container } = renderWith(assets, {
      toolDetails: { hash: "h", mimeType: "video/mp4", filename: "clip.mp4" },
    });
    const v = container.querySelector("video");
    expect(v).not.toBeNull();
    expect(v?.getAttribute("src")).toBe(`${window.location.origin}/api/assets/h`);
  });

  it("renders an <iframe> for PDF", () => {
    const assets: SessionAssets = { h: { mimeType: "application/pdf" } };
    const { container } = renderWith(assets, {
      toolDetails: { hash: "h", mimeType: "application/pdf", filename: "doc.pdf" },
    });
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe(`${window.location.origin}/api/assets/h`);
  });

  it("renders an <img> (click → lightbox) for images", () => {
    const assets: SessionAssets = { h: { mimeType: "image/png" } };
    const { getByRole, getByTestId } = renderWith(assets, {
      toolDetails: { hash: "h", mimeType: "image/png", filename: "shot.png" },
    });
    const img = getByRole("img");
    expect(img.getAttribute("src")).toBe(`${window.location.origin}/api/assets/h`);
    fireEvent.click(img);
    expect(getByTestId("lightbox").getAttribute("data-src")).toBe(`${window.location.origin}/api/assets/h`);
  });

  it("renders a text hint + link for text types (no inline <pre>)", () => {
    const assets: SessionAssets = { h: { mimeType: "application/json" } };
    const { container, getByRole } = renderWith(assets, {
      toolDetails: { hash: "h", mimeType: "application/json", filename: "data.json" },
    });
    expect(container.querySelector("audio")).toBeNull();
    expect(container.querySelector("video")).toBeNull();
    expect(getByRole("link").getAttribute("href")).toBe(`${window.location.origin}/api/assets/h`);
  });

  it("renders a download hint + link for unknown/other types", () => {
    const assets: SessionAssets = { h: { mimeType: "application/zip" } };
    const { getByRole, getByText } = renderWith(assets, {
      toolDetails: { hash: "h", mimeType: "application/zip", filename: "arch.zip" },
    });
    expect(getByRole("link").getAttribute("href")).toBe(`${window.location.origin}/api/assets/h`);
    expect(getByText(/application\/zip/)).toBeTruthy();
  });

  it("shows caption below the preview", () => {
    const assets: SessionAssets = { h: { mimeType: "audio/mpeg" } };
    const { getByText } = renderWith(assets, {
      toolDetails: { hash: "h", mimeType: "audio/mpeg", caption: "Generated voice clip" },
    });
    expect(getByText("Generated voice clip")).toBeTruthy();
  });

  it("shows a loading state while running", () => {
    const { getByText } = renderWith({}, { status: "running" });
    expect(getByText(/Reading file/)).toBeTruthy();
  });

  it("shows a loading state when hash present but asset not yet registered", () => {
    const { getByText } = renderWith({}, { toolDetails: { hash: "not-yet" } });
    expect(getByText(/Loading file/)).toBeTruthy();
  });

  it("renders the bridge error message when details.error is set", () => {
    const { getByText } = renderWith({}, {
      toolDetails: { error: "not_found", message: "file not found: nope.mp3" },
    });
    expect(getByText("file not found: nope.mp3")).toBeTruthy();
  });

  it("renders 'File unavailable' when complete with no hash and no error", () => {
    const { getByText } = renderWith({}, {});
    expect(getByText("File unavailable.")).toBeTruthy();
  });
});
