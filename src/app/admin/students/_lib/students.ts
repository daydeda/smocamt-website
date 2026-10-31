import type { EditableContact } from "../_components/ContactsEditor";

export type Student = {
  id: string;
  studentId?: string;
  prefix?: string;
  name: string;
  nickname?: string;
  major?: string;
  // SMO/ANUSMO staff titles (src/lib/positions.ts), scoped independently — a
  // student can hold both roles at once with a different title in each. Club
  // titles live on club_members.position (edited in admin/clubs's Members
  // modal) and major titles on users.majorPosition (admin/majors's Team
  // panel) — neither is edited from this page.
  smoPosition?: string | null;
  anusmoPosition?: string | null;
  email?: string;
  phone?: string;
  // Both email and phone are only ever present on this Student object when the
  // requester is super_admin — see GET /api/admin/students, which strips
  // these columns for every other role (PDPA minimization).
  contactChannels?: string | null;
  houseId?: string;
  house?: { id: string; name: string; color?: string } | null;
  profileCompleted?: boolean;
  role?: string;
  roles?: string[];
  noShowCount?: number;
  registrationBlocked?: boolean;
  chronicDiseases?: string | null;
  medicalHistory?: string | null;
  drugAllergies?: string | null;
  foodAllergies?: string | null;
  dietaryRestrictions?: string | null;
  faintingHistory?: boolean | null;
  hospitalNumber?: string | null;
  hospitalName?: string | null;
  // Split name parts (the display `name` is rebuilt from them on save).
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  latinNameConfirmed?: boolean;
  emergencyContacts?: EditableContact[] | null;
  // Clubs this user presides over (club_president identity — see
  // EventScopeService). Only fetched/shown when the club_president checkbox is
  // checked in the edit modal.
  clubIds?: string[];
};

export type House = { id: string; name: string; faculty?: string; colorGroup?: string };
export type Club = { id: string; name: string; isArchived: boolean };

export const ITEMS_PER_PAGE = 50;

export const rolesOf = (s: Pick<Student, "roles" | "role">): string[] =>
  s.roles || (s.role ? [s.role] : ["student"]);

export function hasActualMedicalInfo(user: Student): boolean {
  if (!user) return false;
  const fields = [
    user.chronicDiseases,
    user.medicalHistory,
    user.drugAllergies,
    user.foodAllergies,
    user.dietaryRestrictions,
  ];
  const isMeaningful = (val: string | null | undefined) => {
    if (typeof val !== "string") return !!val;
    const t = val.trim();
    return t !== "" && t !== "-";
  };
  return fields.some(isMeaningful) || user.faintingHistory === true;
}

export function deriveEducationLevel(studentId: string | undefined): "undergrad" | "masters" | "phd" | null {
  if (!studentId || studentId.length < 5) return null;
  const d = studentId.trim()[4];
  if (d === "3") return "masters";
  if (d === "5") return "phd";
  return "undergrad";
}

export function houseColorFor(colorGroup: string): string {
  return colorGroup === "red" ? "var(--red-500)"
    : colorGroup === "blue" ? "var(--blue-500)"
    : colorGroup === "green" ? "var(--emerald-500)"
    : colorGroup === "yellow" ? "var(--amber-500)"
    : "var(--accent-primary)";
}

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
