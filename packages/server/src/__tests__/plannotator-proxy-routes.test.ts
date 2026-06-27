import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import compress from "@fastify/compress";
import { createServer, type Server } from "node:http";
import { registerPlannotatorProxyRoutes } from "../routes/plannotator-proxy-routes.js";

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing test port");
      resolve(address.port);
    });
  });
}

describe("Plannotator proxy routes", () => {
  let app: FastifyInstance | undefined;
  let upstream: Server | undefined;

  afterEach(async () => {
    if (app) await app.close();
    if (upstream) await new Promise<void>((resolve) => upstream!.close(() => resolve()));
    app = undefined;
    upstream = undefined;
  });

  it("proxies the Plannotator UI under /plannotator and rewrites root API links", async () => {
    upstream = createServer((req, res) => {
      expect(req.url).toBe("/");
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Location", "/api/plan");
      res.end(`<link rel="icon" href="/favicon.svg"><script>fetch("/api/plan");fetch(\`/api/draft\`)</script>`);
    });
    const targetPort = await listen(upstream);

    app = Fastify({ logger: false });
    registerPlannotatorProxyRoutes(app, { networkGuard: async () => {}, targetPort });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/plannotator/" });

    expect(res.statusCode).toBe(200);
    expect(res.headers.location).toBe("/plannotator/api/plan");
    expect(res.body).toContain('href="/plannotator/favicon.svg"');
    expect(res.body).toContain('fetch("/plannotator/api/plan")');
    expect(res.body).toContain("fetch(`/plannotator/api/draft`)");
  });

  it("does not let global compression turn the proxied HTML into an empty gzip response", async () => {
    upstream = createServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html><div>${"x".repeat(2000)}</div>`);
    });
    const targetPort = await listen(upstream);

    app = Fastify({ logger: false });
    await app.register(compress, { global: true, threshold: 1024, encodings: ["gzip", "deflate"] });
    registerPlannotatorProxyRoutes(app, { networkGuard: async () => {}, targetPort });
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/plannotator/",
      headers: { "accept-encoding": "gzip" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body).toContain("<!doctype html>");
    expect(res.body.length).toBeGreaterThan(2000);
  });

  it("proxies a session-specific Plannotator UI under /plannotator/:sessionId", async () => {
    upstream = createServer((req, res) => {
      expect(req.url).toBe("/");
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Location", "/api/plan");
      res.end(`<link rel="icon" href="/favicon.svg"><script>fetch("/api/plan")</script>`);
    });
    const targetPort = await listen(upstream);

    app = Fastify({ logger: false });
    registerPlannotatorProxyRoutes(app, { networkGuard: async () => {}, targetPort });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/plannotator/session-1" });

    expect(res.statusCode).toBe(200);
    expect(res.headers.location).toBe("/plannotator/session-1/api/plan");
    expect(res.body).toContain('href="/plannotator/session-1/favicon.svg"');
    expect(res.body).toContain('fetch("/plannotator/session-1/api/plan")');
  });

  it("lets legacy /plannotator/ links use the active Plannotator session port", async () => {
    upstream = createServer((req, res) => {
      expect(req.url).toBe("/");
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<script>fetch("/api/plan")</script>`);
    });
    const targetPort = await listen(upstream);

    app = Fastify({ logger: false });
    registerPlannotatorProxyRoutes(app, {
      networkGuard: async () => {},
      sessionManager: {
        get: () => ({
          id: "active-plan",
          status: "active",
          plannotator: { available: true, phase: "planning", port: targetPort, updatedAt: 200 },
        }),
        listAll: () => [{
          id: "active-plan",
          status: "active",
          plannotator: { available: true, phase: "planning", port: targetPort, updatedAt: 200 },
        }],
      } as any,
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/plannotator/" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('fetch("/plannotator/active-plan/api/plan")');
  });

  it("routes different sessions to different Plannotator ports", async () => {
    const upstreamA = createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ session: "a" }));
    });
    const upstreamB = createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ session: "b" }));
    });
    const portA = await listen(upstreamA);
    const portB = await listen(upstreamB);
    upstream = { close: (cb?: (err?: Error) => void) => upstreamA.close(() => upstreamB.close(cb)) } as Server;

    app = Fastify({ logger: false });
    registerPlannotatorProxyRoutes(app, {
      networkGuard: async () => {},
      sessionManager: {
        get: (sessionId: string) => ({ plannotator: { port: sessionId === "a" ? portA : portB } }),
      } as any,
    });
    await app.ready();

    const resA = await app.inject({ method: "GET", url: "/plannotator/a/api/plan" });
    const resB = await app.inject({ method: "GET", url: "/plannotator/b/api/plan" });

    expect(JSON.parse(resA.body)).toEqual({ session: "a" });
    expect(JSON.parse(resB.body)).toEqual({ session: "b" });
  });

  it("supports the /plannonator/:sessionId spelling as an alias", async () => {
    upstream = createServer((req, res) => {
      expect(req.url).toBe("/api/plan?x=1");
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
    const targetPort = await listen(upstream);

    app = Fastify({ logger: false });
    registerPlannotatorProxyRoutes(app, { networkGuard: async () => {}, targetPort });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/plannonator/session-1/api/plan?x=1" });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it("strips the proxy prefix and forwards JSON POST bodies", async () => {
    let observed = { url: "", body: "", contentType: "" };
    upstream = createServer((req, res) => {
      observed.url = req.url ?? "";
      observed.contentType = String(req.headers["content-type"] ?? "");
      req.setEncoding("utf8");
      req.on("data", (chunk) => { observed.body += chunk; });
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      });
    });
    const targetPort = await listen(upstream);

    app = Fastify({ logger: false });
    registerPlannotatorProxyRoutes(app, { networkGuard: async () => {}, targetPort });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/plannotator/api/approve?review=1",
      payload: { feedback: "ship it" },
    });

    expect(res.statusCode).toBe(200);
    expect(observed.url).toBe("/api/approve?review=1");
    expect(observed.contentType).toContain("application/json");
    expect(JSON.parse(observed.body)).toEqual({ feedback: "ship it" });
  });

  it("forwards multipart uploads without Fastify rejecting the content type", async () => {
    let observed = { url: "", body: "", contentType: "" };
    upstream = createServer((req, res) => {
      observed.url = req.url ?? "";
      observed.contentType = String(req.headers["content-type"] ?? "");
      req.setEncoding("utf8");
      req.on("data", (chunk) => { observed.body += chunk; });
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      });
    });
    const targetPort = await listen(upstream);

    app = Fastify({ logger: false });
    registerPlannotatorProxyRoutes(app, { networkGuard: async () => {}, targetPort });
    await app.ready();

    const boundary = "----pi-test-boundary";
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`;
    const res = await app.inject({
      method: "POST",
      url: "/plannotator/api/upload",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(observed.url).toBe("/api/upload");
    expect(observed.contentType).toContain("multipart/form-data");
    expect(observed.body).toBe(payload);
  });
});
