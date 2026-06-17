import React, { useState } from "react";
import { Icon } from "@mdi/react";
import { mdiDownload, mdiOpenInNew, mdiFileOutline } from "@mdi/js";
import { useSessionAssets, useAssetUrl } from "../../lib/SessionAssetsContext.js";
import { useMobile } from "../../hooks/useMobile.js";
import { ImageLightbox } from "../ImageLightbox.js";
import type { ToolRendererProps } from "./types.js";

/**
 * Renderer for the `show_file` tool call — generalisation of `show_image` for
 * ANY file type. The bridge reads/fetches the file, emits `asset_register`
 * with the bytes, and returns `details: { hash, mimeType, size, filename,
 * caption, path }`. This renderer picks a preview strategy by MIME category:
 *
 *   image/*              → <img> (click → lightbox)
 *   audio/*              → <audio controls>
 *   video/*              → <video controls>
 *   application/pdf      → <iframe> preview
 *   text/* / json / etc  → <pre> code block
 *   other                → file icon
 *
 * Every category also gets an open/download link to `/api/assets/<hash>`
 * (opens in a new tab). Mobile: full-width players.
 *
 * See change: add-show-file-tool.
 */
export function ShowFileToolRenderer({ args, status, toolDetails }: ToolRendererProps) {
  const assets = useSessionAssets();
  const buildAssetUrl = useAssetUrl();
  const isMobile = useMobile();
  const [lightboxSrc, setLightboxSrc] = useState<{ src: string; alt: string } | null>(null);

  const hash = typeof toolDetails?.hash === "string" ? (toolDetails.hash as string) : undefined;
  const mimeType = typeof toolDetails?.mimeType === "string" ? (toolDetails.mimeType as string) : undefined;
  const size = typeof toolDetails?.size === "number" ? (toolDetails.size as number) : undefined;
  const caption = typeof toolDetails?.caption === "string" ? (toolDetails.caption as string) : undefined;
  const filename = typeof toolDetails?.filename === "string" ? (toolDetails.filename as string) : undefined;
  const path = typeof args?.path === "string" ? (args.path as string) : undefined;
  const displayName = filename ?? (path ? path.split("/").pop() : "file");

  const errMsg = typeof toolDetails?.message === "string" ? (toolDetails.message as string) : undefined;
  const running = status === "running";
  const asset = hash ? assets[hash] : undefined;
  const loading = running || (hash !== undefined && !asset);

  if (errMsg) {
    return <div className="text-xs text-red-400 italic">{errMsg}</div>;
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] italic">
        <span className="animate-pulse">{running ? "Reading file…" : "Loading file…"}</span>
      </div>
    );
  }
  if (!hash || !asset) {
    return <div className="text-xs text-[var(--text-muted)] italic">File unavailable.</div>;
  }

  const url = buildAssetUrl(hash);
  const mime = mimeType ?? asset.mimeType ?? "application/octet-stream";
  const category = mimeCategory(mime);
  const sizeLabel = size != null ? formatSize(size) : undefined;

  const linkRow = (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 underline decoration-dotted"
    >
      <Icon path={category === "other" ? mdiDownload : mdiOpenInNew} size={0.5} />
      <span className="truncate max-w-[260px]">{displayName}</span>
      {sizeLabel && <span className="text-[var(--text-muted)] no-underline">({sizeLabel})</span>}
    </a>
  );

  return (
    <figure className="m-0 space-y-1.5">
      <Preview
        category={category}
        mime={mime}
        url={url}
        displayName={displayName ?? "file"}
        isMobile={isMobile}
        onImageClick={(src, alt) => setLightboxSrc({ src, alt })}
      />
      <div className="flex items-center gap-2 flex-wrap">
        {linkRow}
      </div>
      {caption && (
        <figcaption className="text-xs text-[var(--text-tertiary)] leading-snug">
          {caption}
        </figcaption>
      )}
      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc.src}
          alt={lightboxSrc.alt}
          onClose={() => setLightboxSrc(null)}
        />
      )}
    </figure>
  );
}

type MimeCategory = "image" | "audio" | "video" | "pdf" | "text" | "other";

function mimeCategory(mime: string): MimeCategory {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript" ||
    mime === "application/sql" ||
    mime === "application/x-sh"
  ) {
    return "text";
  }
  return "other";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PreviewProps {
  category: MimeCategory;
  mime: string;
  url: string;
  displayName: string;
  isMobile: boolean;
  onImageClick: (src: string, alt: string) => void;
}

function Preview({ category, mime, url, displayName, isMobile, onImageClick }: PreviewProps) {
  if (category === "image") {
    const cls = isMobile
      ? "w-full h-auto rounded-lg border border-[var(--border-secondary)] object-contain cursor-pointer"
      : "max-w-[600px] max-h-[600px] rounded-lg border border-[var(--border-secondary)] object-contain cursor-pointer";
    return (
      <img
        src={url}
        alt={displayName}
        className={cls}
        onClick={() => onImageClick(url, displayName)}
      />
    );
  }
  if (category === "audio") {
    return <audio src={url} controls className="w-full" />;
  }
  if (category === "video") {
    return (
      <video
        src={url}
        controls
        className={isMobile ? "w-full rounded-lg border border-[var(--border-secondary)]" : "max-w-[600px] max-h-[600px] rounded-lg border border-[var(--border-secondary)]"}
      />
    );
  }
  if (category === "pdf") {
    return (
      <iframe
        src={url}
        title={displayName}
        className="w-full rounded-lg border border-[var(--border-secondary)]"
        style={{ height: isMobile ? "60vh" : "500px" }}
      />
    );
  }
  if (category === "text") {
    return (
      <div className="text-xs text-[var(--text-muted)] italic flex items-center gap-1">
        <Icon path={mdiFileOutline} size={0.5} />
        Text file — open to view ({mime})
      </div>
    );
  }
  // other — no inline preview, the link row is the affordance.
  return (
    <div className="text-xs text-[var(--text-muted)] italic flex items-center gap-1">
      <Icon path={mdiFileOutline} size={0.5} />
      {mime} — download to view
    </div>
  );
}
