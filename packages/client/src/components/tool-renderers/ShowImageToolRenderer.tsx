import React, { useState } from "react";
import { useSessionAssets, useAssetUrl } from "../../lib/SessionAssetsContext.js";
import { useMobile } from "../../hooks/useMobile.js";
import { ImageLightbox } from "../ImageLightbox.js";
import type { ToolRendererProps } from "./types.js";

/**
 * Renderer for the `show_image` tool call.
 *
 * The bridge reads the image file the model named, emits `asset_register`
 * with the bytes, and returns `details: { hash, caption, alt, path, mimeType }`.
 * This renderer resolves `hash` against the active `SessionAssetsContext`
 * (populated by `asset_register`) and draws a large inline `<figure>` with
 * the image + optional caption — mobile-friendly and lightbox-enabled.
 *
 * Failure states (`details.error`) render a small inline note so the model
 * sees what went wrong without a broken-image glyph.
 *
 * See change: add-show-image-tool.
 */
export function ShowImageToolRenderer({ args, status, toolDetails }: ToolRendererProps) {
  const assets = useSessionAssets();
  const buildAssetUrl = useAssetUrl();
  const isMobile = useMobile();
  const [lightboxSrc, setLightboxSrc] = useState<{ src: string; alt: string } | null>(null);

  const hash = typeof toolDetails?.hash === "string" ? (toolDetails.hash as string) : undefined;
  const caption = typeof toolDetails?.caption === "string" ? (toolDetails.caption as string) : undefined;
  const path = typeof args?.path === "string" ? (args.path as string) : undefined;
  const alt =
    (typeof toolDetails?.alt === "string" ? (toolDetails.alt as string) : undefined) ??
    (path ? path.split("/").pop() : "image") ?? "image";

  // Error returned by the bridge (missing / oversized / unsupported).
  const errMsg =
    typeof toolDetails?.message === "string" ? (toolDetails.message as string) : undefined;

  // Loading: tool is running OR details.hash present but asset bytes not
  // yet in the per-session registry (asset_register may land after the
  // tool_result event).
  const running = status === "running";
  const asset = hash ? assets[hash] : undefined;
  const loading = running || (hash !== undefined && !asset);

  if (errMsg) {
    return <div className="text-xs text-red-400 italic">{errMsg}</div>;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] italic">
        <span className="animate-pulse">{running ? "Reading image…" : "Loading image…"}</span>
      </div>
    );
  }

  if (!hash || !asset) {
    return (
      <div className="text-xs text-[var(--text-muted)] italic">
        Image unavailable.
      </div>
    );
  }

  const src = buildAssetUrl(hash);
  // Mobile: full-width figure; desktop: cap at 600px so it doesn't dominate.
  const imgClass = isMobile
    ? "w-full h-auto rounded-lg border border-[var(--border-secondary)] object-contain cursor-pointer"
    : "max-w-[600px] max-h-[600px] rounded-lg border border-[var(--border-secondary)] object-contain cursor-pointer";

  return (
    <>
      <figure className="m-0">
        <img
          src={src}
          alt={alt}
          className={imgClass}
          onClick={() => setLightboxSrc({ src, alt })}
        />
        {caption && (
          <figcaption className="mt-1.5 text-xs text-[var(--text-tertiary)] leading-snug">
            {caption}
          </figcaption>
        )}
      </figure>
      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc.src}
          alt={lightboxSrc.alt}
          onClose={() => setLightboxSrc(null)}
        />
      )}
    </>
  );
}
