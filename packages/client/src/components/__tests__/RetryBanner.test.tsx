/**
 * Tests for the provider-retry banner.
 * See change: fix-provider-retry-infinite-loop.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";

afterEach(() => cleanup());

import { RetryBanner } from "../RetryBanner";

describe("RetryBanner", () => {
  it("renders attempt count, reason, and countdown", () => {
    const { getByTestId } = render(
      <RetryBanner
        retryState={{
          attempt: 2,
          maxAttempts: 3,
          delayMs: 4000,
          reason: "rate limit exceeded",
          startedAt: 1000,
        }}
        now={() => 1000}
      />,
    );
    expect(getByTestId("retry-banner-attempt").textContent).toContain("retry 2 of 3");
    expect(getByTestId("retry-banner-reason").textContent).toBe("rate limit exceeded");
    expect(getByTestId("retry-banner-countdown").textContent).toBe("4s");
  });

  it("countdown reaches 0 (not negative) and stays", () => {
    const { getByTestId } = render(
      <RetryBanner
        retryState={{
          attempt: 1,
          maxAttempts: 3,
          delayMs: 1000,
          reason: "x",
          startedAt: 0,
        }}
        now={() => 100_000}
      />,
    );
    expect(getByTestId("retry-banner-countdown").textContent).toBe("0s");
  });

  it("invokes onAbort when Stop retrying is clicked", () => {
    const onAbort = vi.fn();
    const { getByTestId } = render(
      <RetryBanner
        retryState={{
          attempt: 1,
          maxAttempts: 3,
          delayMs: 2000,
          reason: "x",
          startedAt: 0,
        }}
        now={() => 0}
        onAbort={onAbort}
      />,
    );
    fireEvent.click(getByTestId("retry-banner-stop"));
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it("does not render Stop retrying when onAbort is omitted", () => {
    const { queryByTestId } = render(
      <RetryBanner
        retryState={{
          attempt: 1,
          maxAttempts: 3,
          delayMs: 2000,
          reason: "x",
          startedAt: 0,
        }}
        now={() => 0}
      />,
    );
    expect(queryByTestId("retry-banner-stop")).toBeNull();
  });

  it("renders indeterminate state when delayMs is -1 (sentinel)", () => {
    const { getByTestId, queryByTestId } = render(
      <RetryBanner
        retryState={{
          attempt: 2,
          maxAttempts: -1,
          delayMs: -1,
          reason: "rate limit",
          startedAt: 0,
        }}
        now={() => 0}
      />,
    );
    expect(getByTestId("retry-banner-indeterminate").textContent).toContain("retrying");
    expect(getByTestId("retry-banner-indeterminate").textContent).toContain("attempt 2");
    expect(queryByTestId("retry-banner-countdown")).toBeNull();
    expect(queryByTestId("retry-banner-attempt")).toBeNull();
  });

  it("renders indeterminate state when maxAttempts is -1", () => {
    const { getByTestId, queryByTestId } = render(
      <RetryBanner
        retryState={{
          attempt: 1,
          maxAttempts: -1,
          delayMs: 5000,
          reason: "x",
          startedAt: 0,
        }}
        now={() => 0}
      />,
    );
    expect(getByTestId("retry-banner-indeterminate")).not.toBeNull();
    expect(queryByTestId("retry-banner-countdown")).toBeNull();
  });

  it("countdown updates every second via setInterval", () => {
    vi.useFakeTimers();
    let clock = 1000;
    const { getByTestId } = render(
      <RetryBanner
        retryState={{
          attempt: 1,
          maxAttempts: 3,
          delayMs: 5000,
          reason: "x",
          startedAt: 1000,
        }}
        now={() => clock}
      />,
    );
    expect(getByTestId("retry-banner-countdown").textContent).toBe("5s");
    clock = 3000;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(getByTestId("retry-banner-countdown").textContent).toBe("3s");
    vi.useRealTimers();
  });
});
