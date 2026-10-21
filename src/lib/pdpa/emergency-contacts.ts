// Shared helper for surfaces that expose a user's emergencyContacts (jsonb:
// [{name, relationship, phone}]) to a viewer who should NOT see the contact's
// own name — e.g. a club/major president's roster view (see
// ClubsService.getClubMembers / MajorsService.getMajorMembers). The redaction
// happens at the data layer so the name is never even serialized to the
// client, not just hidden in the UI.

export interface EmergencyContact {
  name: string;
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
