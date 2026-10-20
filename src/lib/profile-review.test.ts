import { describe, it, expect } from "vitest";
import { isProfileReviewDue, shouldShowProfileReview } from "@/lib/profile-review";

const now = new Date("2026-10-20T00:00:00Z");

describe("isProfileReviewDue", () => {
  it("is due when never reviewed", () => {
    expect(isProfileReviewDue(null, now)).toBe(true);
    expect(isProfileReviewDue(undefined, now)).toBe(true);
  });
  it("is due when the date is unparseable", () => {
    expect(isProfileReviewDue("not-a-date", now)).toBe(true);
  });
  it("is not due within 3 months", () => {
    expect(isProfileReviewDue("2026-08-01T00:00:00Z", now)).toBe(false);
  });
  it("is due exactly 3 months later and after", () => {
    expect(isProfileReviewDue("2026-07-20T00:00:00Z", now)).toBe(true);
    expect(isProfileReviewDue("2026-01-01T00:00:00Z", now)).toBe(true);
  });
  it("accepts a Date", () => {
    expect(isProfileReviewDue(new Date("2026-10-01T00:00:00Z"), now)).toBe(false);
  });
});

describe("shouldShowProfileReview", () => {
  it("never prompts an incomplete profile", () => {
    expect(shouldShowProfileReview({ profileCompleted: false, profileReviewedAt: null }, now)).toBe(false);
    expect(shouldShowProfileReview(null, now)).toBe(false);
  });
  it("prompts a completed, never-reviewed profile", () => {
    expect(shouldShowProfileReview({ profileCompleted: true, profileReviewedAt: null }, now)).toBe(true);
  });
  it("does not prompt a completed profile reviewed recently", () => {
    expect(shouldShowProfileReview({ profileCompleted: true, profileReviewedAt: "2026-10-01T00:00:00Z" }, now)).toBe(false);
  });
});
