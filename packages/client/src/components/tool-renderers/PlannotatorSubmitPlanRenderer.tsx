import React from "react";
import type { ToolRendererProps } from "./types.js";

const DEFAULT_PLANNOTATOR_PORT = "19432";

function getBrowserReviewUrl(): string {
  if (typeof window === "undefined") return `http://localhost:${DEFAULT_PLANNOTATOR_PORT}`;
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${window.location.hostname}:${DEFAULT_PLANNOTATOR_PORT}`;
}

function extractUrl(value: unknown): string | null {
  if (typeof value === "string") return value.match(/https?:\/\/[^\s)\]]+/)?.[0] ?? null;
  if (!value || typeof value !== "object") return null;
  for (const candidate of Object.values(value as Record<string, unknown>)) {
    const found = extractUrl(candidate);
    if (found) return found;
  }
  return null;
}

export function PlannotatorSubmitPlanRenderer({ args, status, result, toolDetails }: ToolRendererProps) {
  const submittedPath = typeof args?.filePath === "string" ? args.filePath : "the submitted plan";
  const discoveredUrl = extractUrl(toolDetails) ?? extractUrl(result);
  const reviewUrl = discoveredUrl ?? getBrowserReviewUrl();

  if (status === "running") {
    return (
      <div className="space-y-2 text-xs">
        <div className="font-medium text-yellow-300">Waiting for Plannotator review</div>
        <div className="text-[var(--text-secondary)]">
          Plan <span className="font-mono">{submittedPath}</span> was submitted. Open the review UI, approve it, or leave feedback; the tool will finish after that decision.
        </div>
        <a
          href={reviewUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex rounded-md border border-blue-400/40 bg-blue-500/10 px-2 py-1 text-blue-200 hover:bg-blue-500/20"
        >
          Open Plannotator review
        </a>
        {!discoveredUrl && (
          <div className="text-[var(--text-muted)]">
            If this link does not open, Plannotator may still be starting or may have stalled before its review server came up.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <pre className="text-xs text-[var(--text-secondary)]">{JSON.stringify(args, null, 2)}</pre>
      {result && (
        <>
          <div className="text-[var(--text-tertiary)] font-medium text-xs">Output:</div>
          <pre className="whitespace-pre-wrap text-xs text-[var(--text-secondary)]">{result}</pre>
        </>
      )}
    </div>
  );
}
