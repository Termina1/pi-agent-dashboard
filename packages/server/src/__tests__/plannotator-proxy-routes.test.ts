import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
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
