import { describe, expect, it } from "vitest";
import { PLANNOTATOR_PROXY_BASE, toPlannotatorProxyUrl } from "../plannotator-url.js";

describe("plannotator URL helpers", () => {
  it("maps localhost review URLs to the dashboard proxy route", () => {
    expect(toPlannotatorProxyUrl("http://localhost:19432/api/plan?x=1#top")).toBe(
      `${PLANNOTATOR_PROXY_BASE}/api/plan?x=1#top`,
    );
  });

  it("maps current-dashboard-host port URLs to the proxy route", () => {
    expect(toPlannotatorProxyUrl(`${window.location.protocol}//${window.location.hostname}:19432/review?from=card`)).toBe(
      `${PLANNOTATOR_PROXY_BASE}/review?from=card`,
    );
  });

  it("maps session-specific localhost review URLs to the session proxy route", () => {
    expect(toPlannotatorProxyUrl("http://localhost:23456/api/plan?x=1", { sessionId: "s1", port: 23456 })).toBe(
      `${PLANNOTATOR_PROXY_BASE}/s1/api/plan?x=1`,
    );
  });

  it("leaves mismatched session ports alone", () => {
    expect(toPlannotatorProxyUrl("http://localhost:23457/api/plan?x=1", { sessionId: "s1", port: 23456 })).toBeNull();
  });

  it("leaves non-Plannotator URLs alone", () => {
    expect(toPlannotatorProxyUrl("https://example.com:19432/review")).toBeNull();
    expect(toPlannotatorProxyUrl("https://example.com/review")).toBeNull();
  });
});
