// Shared helper for surfaces that expose a user's emergencyContacts (jsonb:
// [{name, relationship, phone}]) to a viewer who should NOT see the contact's
// own name — e.g. a club/major president's roster view (see
// ClubsService.getClubMembers / MajorsService.getMajorMembers). The redaction
// happens at the data layer so the name is never even serialized to the
// client, not just hidden in the UI.

export interface EmergencyContact {
  name: string;
  nickname?: string;
  relationship: string;
  phone: string;
}

export interface RedactedEmergencyContact {
  relationship: string;
  phone: string;
}

export function redactEmergencyContacts(raw: unknown): RedactedEmergencyContact[] {
  if (!Array.isArray(raw)) return [];
  return (raw as EmergencyContact[])
    .filter((c) => c && typeof c === "object")
    .map((c) => ({ relationship: c.relationship || "", phone: c.phone || "" }));
}

// ── Spreadsheet export columns ─────────────────────────────────────────────
// One column per contact field instead of a single "Father: 081…; Mother: 081…"
// cell, so staff can filter/sort/copy a phone number. A president-tier export has
// no contact name (redacted at the data layer), so the Name columns are optional.

import { formatPhone } from "@/lib/profile/phone";

const RELATIONSHIP_LABELS: Record<string, string> = {
  Father: "บิดา (Father)",
  Mother: "มารดา (Mother)",
  Guardian: "ผู้ปกครอง (Guardian)",
  Sibling: "พี่น้อง (Sibling)",
  Relative: "ญาติ (Relative)",
  Friend: "เพื่อน (Friend)",
};

/** Stored relationship ("Father", "Other:ลุง", or legacy free text) -> readable label. */
export function relationshipLabel(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (v.startsWith("Other:")) return v.slice(6).trim();
  return RELATIONSHIP_LABELS[v] ?? v;
}

export const EMERGENCY_CONTACT_SLOTS = 2;

export function emergencyContactHeaders(withName: boolean): string[] {
  const out: string[] = [];
  for (let i = 1; i <= EMERGENCY_CONTACT_SLOTS; i++) {
    if (withName) out.push(`Emergency Contact ${i} Name`, `Emergency Contact ${i} Nickname`);
    out.push(`Emergency Contact ${i} Relationship`, `Emergency Contact ${i} Phone`);
  }
  return out;
}

/** Row cells matching emergencyContactHeaders(withName). Missing contacts are "". */
export function emergencyContactColumns(raw: unknown, withName: boolean): Record<string, string> {
  const list = Array.isArray(raw) ? (raw as Partial<EmergencyContact>[]) : [];
  const cols: Record<string, string> = {};
  for (let i = 1; i <= EMERGENCY_CONTACT_SLOTS; i++) {
    const c = list[i - 1];
    if (withName) {
      cols[`Emergency Contact ${i} Name`] = c?.name?.trim() ?? "";
      cols[`Emergency Contact ${i} Nickname`] = c?.nickname?.trim() ?? "";
    }
    cols[`Emergency Contact ${i} Relationship`] = relationshipLabel(c?.relationship);
    cols[`Emergency Contact ${i} Phone`] = c?.phone ? formatPhone(c.phone) : "";
  }
  return cols;
}
