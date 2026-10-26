// Study-year helpers derived from the first two digits of a 9-digit CMU student id
// (intake year, Buddhist Era, last two digits: 68 = 2568).

/** The study year steps up on 1 May (end of the semester); before that we are still in the previous one. */
function academicYearBE(now: Date): number {
  const month = now.getMonth(); // 0-based
  return now.getFullYear() + 543 - (month < 4 ? 1 : 0);
}

/** Intake year (BE) from a student id, or null when the id is too short / non-numeric. */
export function intakeYearBE(studentId: string): number | null {
  const m = /^(\d{2})/.exec(studentId.trim());
  return m ? 2500 + Number(m[1]) : null;
}

/** 1 = first-year in the current academic year. Null while the id prefix is incomplete. */
export function studyYear(studentId: string, now: Date = new Date()): number | null {
  const intake = intakeYearBE(studentId);
  return intake === null ? null : academicYearBE(now) - intake + 1;
}

/** Fifth year or beyond: ask whether the student has already graduated. */
export function isSeniorStudentId(studentId: string, now: Date = new Date()): boolean {
  if (!/^\d{9}$/.test(studentId.trim())) return false;
  const y = studyYear(studentId, now);
  return y !== null && y >= 5;
}
