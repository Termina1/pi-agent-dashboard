import { derivePlannotatorSessionPort } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SessionManager } from "../memory-session-manager.js";
import type { NetworkGuard } from "./route-deps.js";

export const PLANNOTATOR_PROXY_PREFIX = "/plannotator";
export const PLANNONATOR_PROXY_PREFIX = "/plannonator";
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

function stripProxyPrefix(rawUrl: string, prefix: string): string {
  const withoutPrefix = rawUrl.startsWith(`${prefix}/`)
    ? rawUrl.slice(prefix.length)
    : rawUrl.slice(prefix.length) || "/";
  return withoutPrefix.startsWith("/") ? withoutPrefix : `/${withoutPrefix}`;
}

function stripSessionProxyPrefix(rawUrl: string, prefix: string): string {
  if (!rawUrl.startsWith(`${prefix}/`)) return stripProxyPrefix(rawUrl, prefix);
  const withoutPrefix = rawUrl.slice(prefix.length + 1);
  const firstSeparator = withoutPrefix.search(/[/?#]/);
  if (firstSeparator === -1) return "/";
  const rest = withoutPrefix.slice(firstSeparator);
  if (rest.startsWith("/")) return rest;
  return `/${rest}`;
}

function isTextResponse(contentType: string | null): boolean {
  const normalized = (contentType ?? "").toLowerCase();
  return normalized.includes("text/html") || normalized.includes("text/javascript") || normalized.includes("application/javascript");
}

export function rewritePlannotatorProxyText(text: string, basePath = PLANNOTATOR_PROXY_PREFIX): string {
  return text
    .replace(/(["'`])\/api\//g, `$1${basePath}/api/`)
    .replace(/(["'`])\/favicon\.svg/g, `$1${basePath}/favicon.svg`);
}

function rewriteLocation(value: string, basePath: string, targetPort: number): string {
  try {
    const url = new URL(value);
    if (url.port === String(targetPort)) {
      return `${basePath}${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    // Relative Location header.
  }
  if (value.startsWith("/")) return `${basePath}${value}`;
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

function copyResponseHeaders(upstream: Response, reply: FastifyReply, rewriteBody: boolean, basePath: string, targetPort: number): void {
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) return;
    // Let Fastify/compression compute the correct length after body rewrite or gzip.
    if (lower === "content-length") return;
    if (lower === "location") {
      reply.header(key, rewriteLocation(value, basePath, targetPort));
      return;
    }
    if (rewriteBody && lower === "content-encoding") return;
    reply.header(key, value);
  });
}

function isValidPort(port: unknown): port is number {
  return Number.isInteger(port) && (port as number) > 0 && (port as number) < 65536;
}

function resolveDefaultTargetPort(override?: number): number {
  if (override !== undefined) return override;
  const parsed = Number(process.env.PLANNOTATOR_PORT);
  return isValidPort(parsed) ? parsed : DEFAULT_PLANNOTATOR_PORT;
}

function resolveSessionTargetPort(deps: { sessionManager?: SessionManager; targetPort?: number }, sessionId: string | undefined): number {
  if (deps.targetPort !== undefined) return deps.targetPort;
  if (!sessionId) return resolveDefaultTargetPort();
  const reportedPort = deps.sessionManager?.get(sessionId)?.plannotator?.port;
  return isValidPort(reportedPort) ? reportedPort : derivePlannotatorSessionPort(sessionId);
}

function buildProxyBasePath(prefix: string, sessionId: string | undefined): string {
  return sessionId ? `${prefix}/${encodeURIComponent(sessionId)}` : prefix;
}

function getSessionId(request: FastifyRequest): string | undefined {
  const params = request.params as { sessionId?: string } | undefined;
  return params?.sessionId;
}

function getReferrerSessionId(request: FastifyRequest): string | undefined {
  const referrer = request.headers.referer ?? request.headers.referrer;
  const raw = Array.isArray(referrer) ? referrer[0] : referrer;
  if (!raw) return undefined;
  try {
    const url = new URL(raw, "http://dashboard.local");
    const match = url.pathname.match(/^\/session\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

function pickLatestPlannotatorSession(sessionManager: SessionManager | undefined): string | undefined {
  if (!sessionManager) return undefined;
  const candidates = sessionManager
    .listAll()
    .filter((session) => session.status !== "ended" && session.plannotator?.available === true)
    .sort((a, b) => {
      const phaseScore = (session: typeof a) => session.plannotator?.phase === "planning" ? 1 : 0;
      const phaseDelta = phaseScore(b) - phaseScore(a);
      if (phaseDelta !== 0) return phaseDelta;
      return (b.plannotator?.updatedAt ?? 0) - (a.plannotator?.updatedAt ?? 0);
    });
  return candidates[0]?.id;
}

function inferSessionIdForLegacyRoute(request: FastifyRequest, sessionManager: SessionManager | undefined): string | undefined {
  const referrerSessionId = getReferrerSessionId(request);
  if (referrerSessionId && sessionManager?.get(referrerSessionId)?.status !== "ended") return referrerSessionId;
  return pickLatestPlannotatorSession(sessionManager);
}

export function registerPlannotatorProxyRoutes(
  fastify: FastifyInstance,
  deps: { networkGuard: NetworkGuard; sessionManager?: SessionManager; targetPort?: number },
): void {
  const createHandler = (prefix: string, sessionRoute: boolean) => async (request: FastifyRequest, reply: FastifyReply) => {
    const explicitSessionId = sessionRoute ? getSessionId(request) : undefined;
    const sessionId = explicitSessionId ?? inferSessionIdForLegacyRoute(request, deps.sessionManager);
    const targetPort = resolveSessionTargetPort(deps, sessionId);
    const basePath = buildProxyBasePath(prefix, sessionId);
    const upstreamPath = explicitSessionId ? stripSessionProxyPrefix(request.url, prefix) : stripProxyPrefix(request.url, prefix);
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
    copyResponseHeaders(upstream, reply, rewriteBody, basePath, targetPort);
    reply.code(upstream.status);

    if (rewriteBody) {
      const text = await upstream.text();
      reply.send(rewritePlannotatorProxyText(text, basePath));
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    reply.send(buffer);
  };

  const registerPrefix = (prefix: string) => {
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

      const routeOpts = { preHandler: deps.networkGuard, bodyLimit: MAX_PROXY_BODY_BYTES, config: { compress: false as const } };
      const defaultHandler = createHandler(prefix, false);
      const sessionHandler = createHandler(prefix, true);
      scope.all("/", routeOpts, defaultHandler);
      scope.all("/api/*", routeOpts, defaultHandler);
      scope.all("/favicon.svg", routeOpts, defaultHandler);
      scope.all("/:sessionId", routeOpts, sessionHandler);
      scope.all("/:sessionId/*", routeOpts, sessionHandler);
    }, { prefix });
  };

  registerPrefix(PLANNOTATOR_PROXY_PREFIX);
  registerPrefix(PLANNONATOR_PROXY_PREFIX);
}
