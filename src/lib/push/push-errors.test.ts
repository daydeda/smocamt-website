import { describe, it, expect } from "vitest";
import {
  isDeadSubscriptionStatus,
  shouldPruneAfterFailure,
  FAILURE_PRUNE_THRESHOLD,
  STALE_AFTER_MS,
} from "./push-errors";

describe("isDeadSubscriptionStatus", () => {
  it("returns true for 404 status code", () => {
    expect(isDeadSubscriptionStatus(404)).toBe(true);
  });

  it("returns true for 410 status code", () => {
    expect(isDeadSubscriptionStatus(410)).toBe(true);
  });

  it("returns false for other success status codes", () => {
    expect(isDeadSubscriptionStatus(200)).toBe(false);
    expect(isDeadSubscriptionStatus(201)).toBe(false);
  });

  it("returns false for other client error status codes", () => {
    expect(isDeadSubscriptionStatus(400)).toBe(false);
    expect(isDeadSubscriptionStatus(401)).toBe(false);
    expect(isDeadSubscriptionStatus(403)).toBe(false);
    expect(isDeadSubscriptionStatus(405)).toBe(false);
  });

  it("returns false for server error status codes", () => {
    expect(isDeadSubscriptionStatus(500)).toBe(false);
    expect(isDeadSubscriptionStatus(502)).toBe(false);
    expect(isDeadSubscriptionStatus(503)).toBe(false);
  });

  it("returns false for undefined status code", () => {
    expect(isDeadSubscriptionStatus(undefined)).toBe(false);
  });

  it("returns false for zero", () => {
    expect(isDeadSubscriptionStatus(0)).toBe(false);
  });
});

describe("FAILURE_PRUNE_THRESHOLD", () => {
  it("is exported as 5", () => {
    expect(FAILURE_PRUNE_THRESHOLD).toBe(5);
  });
});

describe("STALE_AFTER_MS", () => {
  it("is 14 days", () => {
    expect(STALE_AFTER_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });
});

describe("shouldPruneAfterFailure", () => {
  const now = new Date("2026-10-23T00:00:00Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

  it("always prunes a dead subscription (404/410), even right after a success", () => {
    expect(shouldPruneAfterFailure(404, 1, daysAgo(0), now)).toBe(true);
    expect(shouldPruneAfterFailure(410, 1, daysAgo(0), now)).toBe(true);
    expect(shouldPruneAfterFailure(410, 0, null, now)).toBe(true);
  });

  it("keeps a subscription below the failure threshold", () => {
    expect(shouldPruneAfterFailure(500, 4, daysAgo(60), now)).toBe(false);
    expect(shouldPruneAfterFailure(undefined, 1, daysAgo(60), now)).toBe(false);
  });

  it("keeps a recently working subscription even after many transient failures", () => {
    expect(shouldPruneAfterFailure(500, 5, daysAgo(1), now)).toBe(false);
    expect(shouldPruneAfterFailure(403, 50, daysAgo(13), now)).toBe(false);
  });

  it("prunes a subscription that has failed repeatedly and been stale for 14 days", () => {
    expect(shouldPruneAfterFailure(500, 5, daysAgo(14), now)).toBe(true);
    expect(shouldPruneAfterFailure(429, 9, daysAgo(30), now)).toBe(true);
  });

  it("prunes a repeatedly failing subscription with no known good time", () => {
    expect(shouldPruneAfterFailure(500, 5, null, now)).toBe(true);
  });

  it("does not prune a stale subscription until the failure threshold is reached", () => {
    expect(shouldPruneAfterFailure(500, 4, daysAgo(30), now)).toBe(false);
  });
});
