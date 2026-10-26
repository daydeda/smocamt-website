import { describe, it, expect } from "vitest";
import { studyYear, isSeniorStudentId, intakeYearBE } from "./student-year";

const oct2026 = new Date(2026, 9, 26); // academic year 2569
const mar2027 = new Date(2027, 2, 1); // still academic year 2569
const may2027 = new Date(2027, 4, 1); // rolled over to 2570

describe("student-year", () => {
  it("reads the intake year from the id prefix", () => {
    expect(intakeYearBE("680610123")).toBe(2568);
    expect(intakeYearBE("6")).toBeNull();
  });
  it("counts study years by academic year", () => {
    expect(studyYear("690610123", oct2026)).toBe(1);
    expect(studyYear("680610123", oct2026)).toBe(2);
    expect(studyYear("650610123", mar2027)).toBe(5);
  });
  it("rolls over on 1 May", () => {
    expect(studyYear("690610123", may2027)).toBe(2);
    expect(studyYear("680610123", may2027)).toBe(3);
    expect(studyYear("680610123", new Date(2027, 3, 30))).toBe(2);
  });
  it("flags 5th year and above", () => {
    expect(isSeniorStudentId("660610123", oct2026)).toBe(false);
    expect(isSeniorStudentId("650610123", oct2026)).toBe(true);
    expect(isSeniorStudentId("650610123", new Date(2026, 3, 30))).toBe(false); // 30 Apr: still year 4
    expect(isSeniorStudentId("650610123", new Date(2026, 4, 1))).toBe(true); // 1 May: year 5
    expect(isSeniorStudentId("640610123", oct2026)).toBe(true);
    expect(isSeniorStudentId("600610123", oct2026)).toBe(true);
    expect(isSeniorStudentId("12", oct2026)).toBe(false);
  });
});
