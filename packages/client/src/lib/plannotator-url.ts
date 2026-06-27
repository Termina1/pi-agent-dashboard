export const PLANNOTATOR_PROXY_BASE = "/plannotator";
export const DEFAULT_PLANNOTATOR_PORT = "19432";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

function isCurrentBrowserHost(hostname: string): boolean {
  return typeof window !== "undefined" && hostname === window.location.hostname;
}

function withProxyBase(pathname: string, search: string, hash: string): string {
  const path = pathname === "/" ? "/" : pathname;
  return `${PLANNOTATOR_PROXY_BASE}${path}${search}${hash}`;
}

export function toPlannotatorProxyUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    const isKnownPlannotatorHost =
      LOOPBACK_HOSTS.has(url.hostname) ||
      (url.port === DEFAULT_PLANNOTATOR_PORT && isCurrentBrowserHost(url.hostname));
    if (!isKnownPlannotatorHost || url.port !== DEFAULT_PLANNOTATOR_PORT) return null;

    return withProxyBase(url.pathname || "/", url.search, url.hash);
  } catch {
    return null;
  }
}

export function getDefaultPlannotatorProxyUrl(): string {
  return `${PLANNOTATOR_PROXY_BASE}/`;
}

export function normalizePlannotatorReviewUrl(raw: string | null | undefined): string {
  if (!raw) return getDefaultPlannotatorProxyUrl();
  return toPlannotatorProxyUrl(raw) ?? raw;
}
