import { describe, it, expect } from "vitest";
import {
  isDeadSubscriptionStatus,
  shouldPruneAfterFailure,
  FAILURE_PRUNE_THRESHOLD,
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

describe("shouldPruneAfterFailure", () => {
  it("returns true when statusCode is 404 (dead subscription)", () => {
    expect(shouldPruneAfterFailure(404, 1)).toBe(true);
    expect(shouldPruneAfterFailure(404, 5)).toBe(true);
  });

  it("returns true when statusCode is 410 (dead subscription)", () => {
    expect(shouldPruneAfterFailure(410, 1)).toBe(true);
    expect(shouldPruneAfterFailure(410, 5)).toBe(true);
  });

  it("returns true when failureCountAfterThisFailure >= FAILURE_PRUNE_THRESHOLD", () => {
    expect(shouldPruneAfterFailure(500, 5)).toBe(true);
    expect(shouldPruneAfterFailure(500, 6)).toBe(true);
    expect(shouldPruneAfterFailure(500, 10)).toBe(true);
  });

  it("returns true when failureCountAfterThisFailure >= 5 regardless of status", () => {
    expect(shouldPruneAfterFailure(undefined, 5)).toBe(true);
    expect(shouldPruneAfterFailure(200, 5)).toBe(true);
  });

  it("returns false when failureCountAfterThisFailure < FAILURE_PRUNE_THRESHOLD and status is not dead", () => {
    expect(shouldPruneAfterFailure(500, 4)).toBe(false);
    expect(shouldPruneAfterFailure(500, 1)).toBe(false);
    expect(shouldPruneAfterFailure(500, 0)).toBe(false);
  });

  it("returns false when failureCountAfterThisFailure < FAILURE_PRUNE_THRESHOLD and status is undefined", () => {
    expect(shouldPruneAfterFailure(undefined, 4)).toBe(false);
    expect(shouldPruneAfterFailure(undefined, 1)).toBe(false);
    expect(shouldPruneAfterFailure(undefined, 0)).toBe(false);
  });

  it("handles boundary condition at threshold - 1 (4)", () => {
    expect(shouldPruneAfterFailure(500, 4)).toBe(false);
  });

  it("handles boundary condition at threshold (5)", () => {
    expect(shouldPruneAfterFailure(500, 5)).toBe(true);
  });

  it("handles boundary condition at threshold + 1 (6)", () => {
    expect(shouldPruneAfterFailure(500, 6)).toBe(true);
  });

  it("returns true for dead status regardless of failure count", () => {
    expect(shouldPruneAfterFailure(404, 0)).toBe(true);
    expect(shouldPruneAfterFailure(410, 0)).toBe(true);
  });

  it("combines conditions correctly: dead subscription takes precedence", () => {
    expect(shouldPruneAfterFailure(404, 1)).toBe(true);
    expect(shouldPruneAfterFailure(410, 3)).toBe(true);
  });

  it("handles various transient error codes below threshold", () => {
    expect(shouldPruneAfterFailure(429, 4)).toBe(false);
    expect(shouldPruneAfterFailure(500, 4)).toBe(false);
    expect(shouldPruneAfterFailure(502, 4)).toBe(false);
    expect(shouldPruneAfterFailure(503, 4)).toBe(false);
  });

  it("prunes transient errors at or above threshold", () => {
    expect(shouldPruneAfterFailure(500, 5)).toBe(true);
    expect(shouldPruneAfterFailure(429, 5)).toBe(true);
  });
});
