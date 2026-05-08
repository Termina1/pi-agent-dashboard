import { describe, it, expect } from "vitest";
import { getMobileDepth } from "../mobile-depth.js";

describe("getMobileDepth", () => {
  it("returns 0 when no detail route is active", () => {
    expect(getMobileDepth({})).toBe(0);
  });

  it("returns 1 when a session is selected", () => {
    expect(getMobileDepth({ selectedId: "s1" })).toBe(1);
  });

  it("returns 1 when folderTermCwd is set (folder-terminals route)", () => {
    expect(getMobileDepth({ folderTermCwd: "/foo" })).toBe(1);
  });

  it("returns 1 when settings route is active", () => {
    expect(getMobileDepth({ settingsMatch: true })).toBe(1);
  });

  it("returns 1 when tunnel-setup route is active", () => {
    expect(getMobileDepth({ tunnelSetupMatch: true })).toBe(1);
  });

  it("returns 2 when preview is active", () => {
    expect(getMobileDepth({ selectedId: "s1", hasPreview: true })).toBe(2);
  });
});
