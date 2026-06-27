export const PLANNOTATOR_PROXY_BASE = "/plannotator";
export const DEFAULT_PLANNOTATOR_PORT = "19432";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

export interface PlannotatorProxyOptions {
  sessionId?: string;
  port?: number;
}

function isCurrentBrowserHost(hostname: string): boolean {
  return typeof window !== "undefined" && hostname === window.location.hostname;
}

function getProxyBase(options: PlannotatorProxyOptions = {}): string {
  return options.sessionId ? `${PLANNOTATOR_PROXY_BASE}/${encodeURIComponent(options.sessionId)}` : PLANNOTATOR_PROXY_BASE;
}

function withProxyBase(pathname: string, search: string, hash: string, options: PlannotatorProxyOptions = {}): string {
  const path = pathname === "/" ? "/" : pathname;
  return `${getProxyBase(options)}${path}${search}${hash}`;
}

function isLoopbackUrl(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname) || isCurrentBrowserHost(url.hostname);
}

export function toPlannotatorProxyUrl(raw: string, options: PlannotatorProxyOptions = {}): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!isLoopbackUrl(url)) return null;

    const expectedPort = options.port ? String(options.port) : DEFAULT_PLANNOTATOR_PORT;
    if (!options.sessionId && url.port !== expectedPort) return null;
    if (options.sessionId && options.port && url.port !== expectedPort) return null;

    return withProxyBase(url.pathname || "/", url.search, url.hash, options);
  } catch {
    return null;
  }
}

export function getDefaultPlannotatorProxyUrl(options: PlannotatorProxyOptions = {}): string {
  return `${getProxyBase(options)}/`;
}

export function normalizePlannotatorReviewUrl(raw: string | null | undefined, options: PlannotatorProxyOptions = {}): string {
  if (!raw) return getDefaultPlannotatorProxyUrl(options);
  return toPlannotatorProxyUrl(raw, options) ?? raw;
}
