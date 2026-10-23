import { describe, expect, it } from "vitest";
import { cohortOf, pickPromotions, seatsLeft, waitlistPositions } from "./waitlist";

describe("cohortOf", () => {
  it("treats a third-from-last 5 as international, everything else as Thai", () => {
    expect(cohortOf("662115001")).toBe("thai");
    expect(cohortOf("662115501")).toBe("intl");
    expect(cohortOf("")).toBe("thai");
    expect(cohortOf(null)).toBe("thai");
  });
});

describe("seatsLeft", () => {
  it("is unlimited for an unset or zero quota", () => {
    expect(seatsLeft(null, 5)).toBeNull();
    expect(seatsLeft(0, 5)).toBeNull();
  });
  it("never goes negative", () => {
    expect(seatsLeft(10, 7)).toBe(3);
    expect(seatsLeft(10, 12)).toBe(0);
  });
});

describe("pickPromotions", () => {
  const q = [
    { userId: "a", cohort: "thai" as const },
    { userId: "b", cohort: "intl" as const },
    { userId: "c", cohort: "thai" as const },
  ];

  it("promotes the first in line into a single freed seat", () => {
    expect(pickPromotions(q, { overall: 1, thai: null, intl: null })).toEqual(["a"]);
  });

  it("skips a candidate whose cohort is full but keeps going for the other cohort", () => {
    expect(pickPromotions(q, { overall: 1, thai: 0, intl: null })).toEqual(["b"]);
  });

  it("promotes nobody when there is no overall seat", () => {
    expect(pickPromotions(q, { overall: 0, thai: null, intl: null })).toEqual([]);
  });

  it("respects both overall and cohort room across several seats", () => {
    expect(pickPromotions(q, { overall: 3, thai: 1, intl: null })).toEqual(["a", "b"]);
  });
});

describe("waitlistPositions", () => {
  it("returns the user's 1-based place per event", () => {
    const entries = [
      { eventId: "e1", studentId: "x" },
      { eventId: "e1", studentId: "me" },
      { eventId: "e2", studentId: "me" },
    ];
    const pos = waitlistPositions(entries, "me");
    expect(pos.get("e1")).toBe(2);
    expect(pos.get("e2")).toBe(1);
  });
});
