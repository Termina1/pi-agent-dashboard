/**
 * SessionAssetsContext — scopes a per-session image-asset registry to any
 * descendant `MarkdownContent` so `pi-asset:<hash>` srcs can be resolved
 * to `data:` URLs without prop-drilling through every renderer.
 *
 * Default value is an empty Record so non-chat callers (e.g.
 * `PackageReadmeDialog`, `MarkdownPreviewView`) work without a Provider —
 * any `pi-asset:` reference they encounter renders as the unresolved
 * placeholder, which is the same visible state as today's broken-image
 * behavior for any unresolvable URL.
 *
 * See change: chat-markdown-local-images-and-math.
 */
import React, { createContext, useContext } from "react";
import { useApiBase } from "./api-context.js";

/**
 * Per-session image asset registry consumed by the `pi-asset:<hash>`
 * resolver. Bytes live on the server disk (served via `GET /api/assets/:hash`),
 * so only the MIME type is held client-side — no base64 in browser memory.
 * See change: add-disk-backed-image-assets.
 */
export type SessionAssets = Record<string, { mimeType: string; data?: string }>;

const EMPTY_ASSETS: SessionAssets = Object.freeze({}) as SessionAssets;

const SessionAssetsContext = createContext<SessionAssets>(EMPTY_ASSETS);

export function SessionAssetsProvider({
  assets,
  children,
}: {
  assets: SessionAssets | undefined;
  children: React.ReactNode;
}) {
  return (
    <SessionAssetsContext.Provider value={assets ?? EMPTY_ASSETS}>
      {children}
    </SessionAssetsContext.Provider>
  );
}

/** Hook returning the active session's asset map (or empty when no provider). */
export function useSessionAssets(): SessionAssets {
  return useContext(SessionAssetsContext);
}

/**
 * Build the absolute HTTP URL for a persisted image asset from its content
 * hash. Always absolute (includes origin) — relative URLs break across
 * tunnel / cross-origin / dev-proxy setups, so asset <img src> MUST be
 * absolute to match the origin the REST/WS traffic actually uses.
 * Extensionless — the server resolves MIME + streams the file from disk
 * (see `asset-store.ts` + `GET /api/assets/:hash`). Clients need only the
 * hash (present in the `pi-asset:<hash>` token), so rendering survives a
 * cold server restart without any client-side byte cache.
 * See change: add-disk-backed-image-assets.
 */
export function assetUrl(hash: string, apiBase: string): string {
  // apiBase is "" when the API is same-origin as the page; resolve to the
  // page origin so the URL is always absolute.
  const base = apiBase || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/api/assets/${hash}`;
}

/**
 * Hook returning an asset-URL builder that ALWAYS produces an absolute URL,
 * using the active API base (same React context as every other fetch —
 * `useApiBase()`). Same-origin falls back to `window.location.origin` so the
 * URL is never relative. Use this in components so `<img src>` matches the
 * origin the REST/WS traffic uses, including zrok tunnels and cross-origin
 * dev setups.
 * See change: add-disk-backed-image-assets.
 */
export function useAssetUrl(): (hash: string) => string {
  const apiBase = useApiBase();
  return (hash: string) => assetUrl(hash, apiBase);
}
