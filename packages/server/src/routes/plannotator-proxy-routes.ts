import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import type { NetworkGuard } from "./route-deps.js";

export const PLANNOTATOR_PROXY_PREFIX = "/plannotator";
export const DEFAULT_PLANNOTATOR_PORT = 19432;
const MAX_PROXY_BODY_BYTES = 25 * 1024 * 1024;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function stripProxyPrefix(rawUrl: string): string {
  const withoutPrefix = rawUrl.startsWith(`${PLANNOTATOR_PROXY_PREFIX}/`)
    ? rawUrl.slice(PLANNOTATOR_PROXY_PREFIX.length)
    : rawUrl.slice(PLANNOTATOR_PROXY_PREFIX.length) || "/";
  return withoutPrefix.startsWith("/") ? withoutPrefix : `/${withoutPrefix}`;
}

function isTextResponse(contentType: string | null): boolean {
  const normalized = (contentType ?? "").toLowerCase();
  return normalized.includes("text/html") || normalized.includes("text/javascript") || normalized.includes("application/javascript");
}

export function rewritePlannotatorProxyText(text: string): string {
  return text
    .replace(/(["'`])\/api\//g, `$1${PLANNOTATOR_PROXY_PREFIX}/api/`)
    .replace(/(["'`])\/favicon\.svg/g, `$1${PLANNOTATOR_PROXY_PREFIX}/favicon.svg`);
}

function rewriteLocation(value: string): string {
  try {
    const url = new URL(value);
    if (url.port === String(DEFAULT_PLANNOTATOR_PORT)) {
      return `${PLANNOTATOR_PROXY_PREFIX}${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    // Relative Location header.
  }
  if (value.startsWith("/")) return `${PLANNOTATOR_PROXY_PREFIX}${value}`;
  return value;
}

type ProxyRequestBody = string | Uint8Array | undefined;

function buildRequestHeaders(request: FastifyRequest, body: ProxyRequestBody): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === "host" || lower === "content-length" || lower === "accept-encoding") continue;
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, String(value));
    }
  }
  if (body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return headers;
}

function buildRequestBody(request: FastifyRequest): ProxyRequestBody {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return undefined;

  const body = request.body as unknown;
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return body;
  if (typeof body === "object") return JSON.stringify(body);
  return String(body);
}

function copyResponseHeaders(upstream: Response, reply: FastifyReply, rewriteBody: boolean): void {
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) return;
    // Let Fastify/compression compute the correct length after body rewrite or gzip.
    if (lower === "content-length") return;
    if (lower === "location") {
      reply.header(key, rewriteLocation(value));
      return;
    }
    if (rewriteBody && lower === "content-encoding") return;
    reply.header(key, value);
  });
}

function resolveTargetPort(override?: number): number {
  if (override !== undefined) return override;
  const parsed = Number(process.env.PLANNOTATOR_PORT);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_PLANNOTATOR_PORT;
}

export function registerPlannotatorProxyRoutes(
  fastify: FastifyInstance,
  deps: { networkGuard: NetworkGuard; targetPort?: number },
): void {
  const targetPort = resolveTargetPort(deps.targetPort);

  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const upstreamPath = stripProxyPrefix(request.url);
    const upstreamUrl = `http://127.0.0.1:${targetPort}${upstreamPath}`;
    const body = buildRequestBody(request);

    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers: buildRequestHeaders(request, body),
        body: body as any,
        redirect: "manual",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.code(502).send({ success: false, error: `Plannotator proxy failed: ${message}` });
      return;
    }

    const contentType = upstream.headers.get("content-type");
    const rewriteBody = isTextResponse(contentType);
    copyResponseHeaders(upstream, reply, rewriteBody);
    reply.code(upstream.status);

    if (rewriteBody) {
      const text = await upstream.text();
      reply.send(rewritePlannotatorProxyText(text));
      return;
    }

    if (!upstream.body) {
      reply.send();
      return;
    }
    reply.send(Readable.fromWeb(upstream.body as any));
  };

  fastify.register(async (scope) => {
    scope.addContentTypeParser(
      /^multipart\//i,
      { parseAs: "buffer", bodyLimit: MAX_PROXY_BODY_BYTES },
      (_request, body, done) => done(null, body),
    );
    scope.addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer", bodyLimit: MAX_PROXY_BODY_BYTES },
      (_request, body, done) => done(null, body),
    );
    scope.addContentTypeParser(
      /^image\//i,
      { parseAs: "buffer", bodyLimit: MAX_PROXY_BODY_BYTES },
      (_request, body, done) => done(null, body),
    );

    const routeOpts = { preHandler: deps.networkGuard, bodyLimit: MAX_PROXY_BODY_BYTES };
    scope.all("/", routeOpts, handler);
    scope.all("/*", routeOpts, handler);
  }, { prefix: PLANNOTATOR_PROXY_PREFIX });
}
