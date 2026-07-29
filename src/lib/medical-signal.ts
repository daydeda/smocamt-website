// Shared helper for surfaces that need to know WHICH medical categories a
// student has flagged, without ever touching the free-text content — the
// scanner (all roles), the attendance roster, and the attendance XLSX
// export all used to reimplement this independently and disagreed with each
// other on what counts as "no condition" (see toMedicalFlags below).

export interface RawMedicalFields {
  chronicDiseases?: string | null;
  medicalHistory?: string | null;
  drugAllergies?: string | null;
  foodAllergies?: string | null;
  dietaryRestrictions?: string | null;
  faintingHistory?: boolean | null;
  emergencyMedication?: string | null;
}

export const MEDICAL_CATEGORY_KEYS = [
  "chronicDiseases",
  "medicalHistory",
  "drugAllergies",
  "foodAllergies",
  "dietaryRestrictions",
  "emergencyMed",
  "faintingHistory",
] as const;

export type MedicalCategoryKey = (typeof MEDICAL_CATEGORY_KEYS)[number];

export const MEDICAL_CATEGORY_LABELS: Record<MedicalCategoryKey, string> = {
  chronicDiseases: "Chronic Diseases",
  medicalHistory: "Medical History",
  drugAllergies: "Drug Allergies",
  foodAllergies: "Food Allergies",
  dietaryRestrictions: "Dietary Restrictions",
  emergencyMed: "Emergency Medication",
  faintingHistory: "Fainting History",
};

export type MedicalFlags = Record<MedicalCategoryKey, boolean> & {
  hasMedicalCondition: boolean;
};

// A student's explicit "no condition" answer (in Thai or English) must not
// read as a flagged category. Ported verbatim from the scanner's prior
// evaluateMedicalCondition — the attendance roster and export previously
// only excluded "" and "-", which meant e.g. "ไม่มี" was falsely flagged
// there while correctly ignored by the scanner. Unified here on the
// broader list so all three surfaces agree.
const NEGATIVE_VALUES = new Set([
  "", "-", "ไม่มี", "ไม่มีโรคประจำตัว", "ไม่มีประวัติแพ้ยา",
  "ไม่มีประวัติแพ้อาหาร", "ไม่มีโรค", "ไม่มีแพ้ยา",
  "ไม่มีแพ้อาหาร", "ปกติ", "none", "no", "n/a", "nil",
]);

function isMeaningful(val?: string | null): boolean {
  if (!val) return false;
  return !NEGATIVE_VALUES.has(val.trim().toLowerCase());
}

// PDPA signal-only breakdown: WHICH categories are flagged, as booleans — no
// free-text content. Sent to every scanning role (registration/organizer/smo
// included), unlike the raw string fields below which stay admin/super_admin-only.
/**
 * Reduces a student's raw medical fields to a PDPA-safe signal: per-category
 * booleans (which fields are flagged) plus the overall hasMedicalCondition —
 * never the free-text content itself. Callers may send `flags` to ANY scanning
 * role; only the raw string fields elsewhere in this file are admin-gated.
 */
export function toMedicalFlags(fields: RawMedicalFields): MedicalFlags {
  const flags: Record<MedicalCategoryKey, boolean> = {
    chronicDiseases: isMeaningful(fields.chronicDiseases),
    medicalHistory: isMeaningful(fields.medicalHistory),
    drugAllergies: isMeaningful(fields.drugAllergies),
    foodAllergies: isMeaningful(fields.foodAllergies),
    dietaryRestrictions: isMeaningful(fields.dietaryRestrictions),
    emergencyMed: isMeaningful(fields.emergencyMedication),
    faintingHistory: fields.faintingHistory === true,
  };
  return { ...flags, hasMedicalCondition: MEDICAL_CATEGORY_KEYS.some((k) => flags[k]) };
}

// Array-of-keys view for callers that want the flagged categories as a list
// (the attendance roster and XLSX export) rather than the booleans object.
export function medicalCategoriesOf(fields: RawMedicalFields): MedicalCategoryKey[] {
  const flags = toMedicalFlags(fields);
  return MEDICAL_CATEGORY_KEYS.filter((k) => flags[k]);
}
