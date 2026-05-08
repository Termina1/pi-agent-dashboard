import React, { useEffect, useState } from "react";
import { Icon } from "@mdi/react";
import { mdiClockOutline, mdiStop } from "@mdi/js";

export interface RetryStateLike {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  reason: string;
  startedAt: number;
}

interface Props {
  retryState: RetryStateLike;
  onAbort?: () => void;
  /** Override clock for tests. Defaults to Date.now. */
  now?: () => number;
}

/**
 * Transient amber banner shown while pi-coding-agent is sleeping between
 * provider-retry attempts (e.g. after a 429). Distinct from the red
 * ErrorBanner which only appears once retries are exhausted.
 *
 * Spec: openspec/changes/fix-provider-retry-infinite-loop/specs/provider-retry-state/spec.md
 */
export function RetryBanner({ retryState, onAbort, now = Date.now }: Props) {
  // Sentinel `-1` from bridge synthesis means "unknown" — pi doesn't expose its
  // retry settings to extensions, so we render an indeterminate state instead
  // of a countdown. See change: fix-provider-retry-infinite-loop.
  const hasCountdown = retryState.delayMs > 0 && retryState.maxAttempts > 0;
  const target = retryState.startedAt + retryState.delayMs;
  const computeRemaining = () => Math.max(0, Math.ceil((target - now()) / 1000));
  const [remaining, setRemaining] = useState(hasCountdown ? computeRemaining : 0);

  useEffect(() => {
    if (!hasCountdown) return;
    setRemaining(computeRemaining());
    const id = setInterval(() => setRemaining(computeRemaining()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryState.startedAt, retryState.delayMs, hasCountdown]);

  return (
    <div data-testid="retry-banner" className="mt-4 mb-2 mx-auto max-w-2xl">
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5 flex items-start gap-2">
        <Icon path={mdiClockOutline} size={0.7} className="text-amber-400 shrink-0 mt-0.5 animate-pulse" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-amber-200">
            {hasCountdown ? (
              <>
                <span data-testid="retry-banner-attempt">
                  Rate-limited — retry {retryState.attempt} of {retryState.maxAttempts}
                </span>
                <span className="text-amber-300/80"> in </span>
                <span data-testid="retry-banner-countdown" className="font-mono">{remaining}s</span>
              </>
            ) : (
              <span data-testid="retry-banner-indeterminate">
                Rate-limited — retrying… (attempt {retryState.attempt})
              </span>
            )}
          </div>
          <div
            data-testid="retry-banner-reason"
            className="mt-0.5 text-xs text-amber-300/70 truncate"
            title={retryState.reason}
          >
            {retryState.reason}
          </div>
          {onAbort && (
            <div className="mt-1.5">
              <button
                data-testid="retry-banner-stop"
                onClick={onAbort}
                title="Stop retrying"
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-amber-500/40 text-amber-200 hover:bg-amber-500/15"
              >
                <Icon path={mdiStop} size={0.55} />
                Stop retrying
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
