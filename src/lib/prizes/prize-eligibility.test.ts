import { describe, it, expect } from "vitest";
import {
  isPrizeOpen,
  isDuplicateClaim,
  meetsCheckInRequirement,
  isOverQuantity,
  type PrizeEligibilityInput,
} from "./prize-eligibility";

const prize = (over: Partial<PrizeEligibilityInput> = {}): PrizeEligibilityInput => ({
  status: "open",
  onePerStudent: true,
  requireCheckIn: false,
  eligibilityEventId: null,
  ...over,
});

describe("isPrizeOpen", () => {
  it("accepts an open prize", () => {
    expect(isPrizeOpen(prize())).toBe(true);
  });

  it("refuses a closed prize", () => {
    expect(isPrizeOpen(prize({ status: "closed" }))).toBe(false);
  });
});

describe("isDuplicateClaim", () => {
  it("checks for a duplicate when the prize is one-per-student (แจกแก้ว)", () => {
    expect(isDuplicateClaim(prize())).toBe(true);
  });

  it("skips the check when the prize may legitimately repeat", () => {
    expect(isDuplicateClaim(prize({ onePerStudent: false }))).toBe(false);
  });

  it("agrees with the partial unique index condition", () => {
    // The index is `WHERE one_per_student`. If this predicate ever disagreed,
    // the UI would warn about a duplicate the database happily accepts (or
    // worse, stay silent about one it rejects).
    for (const onePerStudent of [true, false]) {
      expect(isDuplicateClaim(prize({ onePerStudent }))).toBe(onePerStudent);
    }
  });
});

describe("meetsCheckInRequirement", () => {
  it("passes everyone when no check-in is required", () => {
    expect(meetsCheckInRequirement(prize(), false)).toBe(true);
  });

  it("refuses a student who did not attend the eligibility event", () => {
    const p = prize({ requireCheckIn: true, eligibilityEventId: "evt-1" });
    expect(meetsCheckInRequirement(p, false)).toBe(false);
  });

  it("admits a student who attended the eligibility event", () => {
    const p = prize({ requireCheckIn: true, eligibilityEventId: "evt-1" });
    expect(meetsCheckInRequirement(p, true)).toBe(true);
  });

  it("passes when requireCheckIn is on but no event was configured", () => {
    // Deliberate: a half-configured prize must not refuse every student at the
    // booth with a reason staff cannot act on.
    const p = prize({ requireCheckIn: true, eligibilityEventId: null });
    expect(meetsCheckInRequirement(p, false)).toBe(true);
  });

  it("ignores the eligibility event when requireCheckIn is off", () => {
    // eligibilityEventId can be set while the requirement is toggled off; the
    // flag alone decides, so toggling off restores access immediately.
    const p = prize({ requireCheckIn: false, eligibilityEventId: "evt-1" });
    expect(meetsCheckInRequirement(p, false)).toBe(true);
  });
});

describe("isOverQuantity", () => {
  it("is never over when the quantity is unlimited", () => {
    expect(isOverQuantity({ quantity: null }, 999)).toBe(false);
  });

  it("warns once the target is reached", () => {
    expect(isOverQuantity({ quantity: 50 }, 49)).toBe(false);
    expect(isOverQuantity({ quantity: 50 }, 50)).toBe(true);
    expect(isOverQuantity({ quantity: 50 }, 51)).toBe(true);
  });

  it("treats a zero quantity as immediately over", () => {
    expect(isOverQuantity({ quantity: 0 }, 0)).toBe(true);
  });
});
