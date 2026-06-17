/**
 * HTTP route for disk-backed image assets.
 *
 * `GET /api/assets/:hash` streams a persisted image (written by the bridge's
 * `asset_register` flow — see `asset-store.ts`). The route is
 * **extensionless**: clients build the URL from the `pi-asset:<hash>` token
 * alone, so no MIME lookup is needed client-side and rendering survives a
 * cold server restart (token is in persisted message text; file + index
 * survive on disk).
 *
 * Gated by `networkGuard` (loopback/trusted OR authenticated) — identical to
 * `/api/file` and every other REST route. When the dashboard is exposed via a
 * zrok tunnel, requests arrive from a non-loopback IP and require JWT auth,
 * so assets are not publicly readable. The 16-hex-char hash is a 64-bit
 * capability token: only browsers that received the `pi-asset:<hash>` token
 * (via a subscribed, authed session) know which URLs to fetch.
 *
 * See change: add-disk-backed-image-assets.
 */
import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import type { NetworkGuard } from "./route-deps.js";
import { readAsset } from "../asset-store.js";

export function registerAssetRoutes(
  fastify: FastifyInstance,
  deps: { networkGuard: NetworkGuard },
): void {
  const { networkGuard } = deps;

  fastify.get<{ Params: { hash: string } }>(
    "/api/assets/:hash",
    { preHandler: networkGuard, config: { compress: false } },
    async (request, reply) => {
      const { hash } = request.params;
      const record = readAsset(hash);
      if (!record) {
        reply.code(404).send({ success: false, error: "asset not found" });
        return;
      }
      // Immutable content-addressed asset — cache aggressively.
      reply.header("Content-Type", record.mimeType);
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
      // Read into a Buffer and send — fastify stream-reply is unreliable
      // under the project's jiti loader (the body arrives empty); a single
      // buffered send matches the working pattern in server.ts' not-found
      // handler. Assets are capped at MAX_PER_IMAGE_BYTES so this is bounded.
      //
      // Do NOT set Content-Length manually: @fastify/compress (global, see
      // server.ts) gzip-encodes text MIME types like image/svg+xml, which
      // shrinks the body below the uncompressed length. A stale manual
      // Content-Length then mismatches the gzipped body and Caddy/zrok
      // truncate the transfer (0 bytes arrive over the tunnel). Letting
      // fastify/compress set Content-Length keeps it correct for both
      // compressed (SVG) and pass-through (JPEG/PNG) responses.
      // See change: add-disk-backed-image-assets.
      try {
        const buf = readFileSync(record.filePath);
        reply.send(buf);
      } catch {
        reply.code(404).send({ success: false, error: "asset not found" });
      }
    },
  );
}
