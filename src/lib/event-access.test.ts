import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildViewer, eventYearFields, getAllowedEventYears, isEligibleFor,
  isEligibleForEventYear, isEligibleForGuest, yearOfStudy,
} from "./event-access";
import { allowedEventYearsSchema } from "./event-schema";

const now = new Date("2026-09-13T05:00:00Z");

afterEach(() => vi.useRealTimers());

function viewer(studentId: string | null, roles = ["student"]) {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  return buildViewer({ studentId, roles, major: "SE" });
}

describe("event student year eligibility", () => {
  it.each([["692110001", 1], ["682110001", 2], ["672110001", 3], ["662110001", 4]])(
    "classifies %s as year %i and permits that year", (studentId, year) => {
      expect(yearOfStudy(studentId, now)).toBe(year);
      expect(isEligibleFor({ allowedYears: [year] }, viewer(studentId))).toBe(true);
    },
  );

  it("allows any selected year and rejects other years for visibility and registration", () => {
    const event = { allowedYears: [2, 4] };
    for (const [studentId, expected] of [["692110001", false], ["682110001", true], ["672110001", false], ["662110001", true], ["652110001", false], [null, false]] as const) {
      expect(isEligibleFor(event, viewer(studentId))).toBe(expected);
      expect(isEligibleForEventYear(event, yearOfStudy(studentId, now))).toBe(expected);
    }
    expect(isEligibleForGuest(event)).toBe(false);
  });

  it("preserves legacy first-year events and lets an explicit empty selection clear them", () => {
    const legacy = { firstYearOnly: true, allowedYears: null };
    expect(getAllowedEventYears(legacy)).toEqual([1]);
    expect(isEligibleFor(legacy, viewer("692110001"))).toBe(true);
    expect(isEligibleFor(legacy, viewer("682110001"))).toBe(false);
    const cleared = { ...legacy, ...eventYearFields({ allowedYears: [] }) };
    expect(isEligibleFor(cleared, viewer("682110001"))).toBe(true);
    expect(isEligibleForGuest(cleared)).toBe(true);
  });

  it("treats no selection as unrestricted, including older or unknown student years", () => {
    for (const allowedYears of [undefined, null, []]) {
      expect(isEligibleFor({ allowedYears }, viewer(null))).toBe(true);
      expect(isEligibleFor({ allowedYears }, viewer("652110001"))).toBe(true);
      expect(isEligibleForGuest({ allowedYears })).toBe(true);
    }
  });

  it.each(["super_admin", "admin", "registration", "organizer"])("preserves the %s year bypass", (role) => {
    expect(isEligibleFor({ allowedYears: [2, 3] }, viewer(null, [role]))).toBe(true);
  });

  it("still applies the other audience restrictions", () => {
    expect(isEligibleFor({ allowedYears: [2], allowedMajors: ["DII"] }, viewer("682110001"))).toBe(false);
    expect(isEligibleFor({ allowedYears: [2], allowedClubs: ["club-1"] }, viewer("682110001"))).toBe(false);
  });

  it("advances years exactly at June 1 midnight in Bangkok", () => {
    expect(yearOfStudy("682110001", new Date("2026-05-31T16:59:59Z"))).toBe(1);
    expect(yearOfStudy("682110001", new Date("2026-05-31T17:00:00Z"))).toBe(2);
    expect(yearOfStudy("692110001", new Date("2026-05-31T16:59:59Z"))).toBeNull();
  });
});

describe("event year updates", () => {
  it("leaves year eligibility untouched in unrelated partial updates", () => {
    expect(eventYearFields({})).toEqual({});
  });

  it("prioritizes explicit selections and keeps the legacy flag synchronized", () => {
    expect(eventYearFields({ allowedYears: [4, 2, 2], firstYearOnly: true })).toEqual({ allowedYears: [2, 4], firstYearOnly: false });
    expect(eventYearFields({ allowedYears: [1] })).toEqual({ allowedYears: [1], firstYearOnly: true });
    expect(eventYearFields({ allowedYears: null, firstYearOnly: true })).toEqual({ allowedYears: [], firstYearOnly: false });
  });

  it("converts old client and pending proposal updates", () => {
    expect(eventYearFields({ firstYearOnly: true })).toEqual({ allowedYears: [1], firstYearOnly: true });
    expect(eventYearFields({ firstYearOnly: false })).toEqual({ allowedYears: [], firstYearOnly: false });
  });

  it("accepts multiple years and rejects invalid API inputs", () => {
    expect(allowedEventYearsSchema.parse([4, 2, 2])).toEqual([2, 4]);
    expect(allowedEventYearsSchema.parse([])).toEqual([]);
    for (const input of [[0], [5], [1.5], ["2"], "2", [1, null]]) {
      expect(allowedEventYearsSchema.safeParse(input).success).toBe(false);
    }
  });
});
