import React from "react";
import { toPlannotatorProxyUrl } from "../../lib/plannotator-url.js";
import type { InteractiveRendererProps } from "./types.js";

const levelColors: Record<string, string> = {
  info: "text-blue-400",
  success: "text-green-400",
  warning: "text-yellow-400",
  error: "text-red-400",
};

function normalizeUrlForCurrentBrowser(raw: string): string {
  const plannotatorProxyUrl = toPlannotatorProxyUrl(raw);
  if (plannotatorProxyUrl) return plannotatorProxyUrl;

  try {
    const url = new URL(raw);
    if (["127.0.0.1", "0.0.0.0", "localhost"].includes(url.hostname) && typeof window !== "undefined") {
      url.hostname = window.location.hostname;
    }
    return url.toString();
  } catch {
    return raw;
  }
}

const urlRe = /https?:\/\/[^\s)\]]+/g;

function extractPlannotatorLink(text: string): string | null {
  for (const match of text.matchAll(urlRe)) {
    const proxied = toPlannotatorProxyUrl(match[0]);
    if (proxied) return proxied;
  }
  return null;
}

function renderMessageWithLinks(message: unknown) {
  const text = typeof message === "string" ? message : message == null ? "" : String(message);
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(urlRe)) {
    const raw = match[0];
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    const href = normalizeUrlForCurrentBrowser(raw);
    parts.push(
      <a
        key={`${raw}-${index}`}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="underline decoration-dotted text-blue-300 hover:text-blue-200"
      >
        {href}
      </a>,
    );
    last = index + raw.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function NotifyRenderer({ params }: InteractiveRendererProps) {
  const message = params.message ?? params.title ?? params.text ?? "";
  const text = typeof message === "string" ? message : message == null ? "" : String(message);
  const level = ((params.level ?? params.notifyType ?? "info") as string);
  const plannotatorLink = extractPlannotatorLink(text);

  if (plannotatorLink) {
    return (
      <div className="mx-4 my-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-[var(--text-secondary)]">
        <div className="font-medium text-blue-300">Plannotator review ready</div>
        <div className="mt-0.5">This appears each time a plan is submitted for review.</div>
        <a
          href={plannotatorLink}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex rounded-md border border-blue-400/40 bg-blue-500/10 px-2 py-1 text-blue-200 hover:bg-blue-500/20"
        >
          Open Plannotator review
        </a>
      </div>
    );
  }

  return (
    <div className={`mx-4 my-1 text-xs whitespace-pre-wrap ${levelColors[level] ?? "text-[var(--text-secondary)]"}`}>
      {renderMessageWithLinks(text)}
    </div>
  );
}
