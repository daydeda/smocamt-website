import { auth } from "@/auth";
import { db } from "@/db";
import { clubs } from "@/db/schema";
import { ClubsService } from "@/modules/clubs/clubs.service";
import { effectiveRoles } from "@/lib/admin-access";
import { POSITION_LABEL_EN, type PositionId } from "@/lib/positions";
import { formatAuditTargetList } from "@/lib/audit-target-list";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { canonicalHouseName } from "@/lib/faculties";

// xlsx is a CommonJS package — keep this route on the Node.js runtime.
export const runtime = "nodejs";

// Same gate as GET/POST/DELETE/PATCH .../members: super_admin/admin (any
// club), or a club_president managing THEIR OWN club (verified server-side
// against club_members — never trust the client-supplied :id alone).
async function canManageClubMembers(
  session: { user?: { role?: string | null; roles?: string[] | null; id?: string | null } } | null,
  clubId: string,
): Promise<boolean> {
  if (!session?.user) return false;
  if (["super_admin", "admin"].includes(session.user.role || "")) return true;
  const isClubPresident = effectiveRoles(session.user.role, session.user.roles).includes("club_president");
  if (!isClubPresident) return false;
  const ownClubIds = await ClubsService.getPresidentClubIds(session.user.id!);
  return ownClubIds.includes(clubId);
}

// GET /api/admin/clubs/[id]/members/export — the club roster as a real .xlsx.
// Same fields as GET .../members: identity, contact, house, position, AND
// medical detail + emergency contacts (relationship + phone only — the
// contact's own name is redacted at the DB layer, see
// ClubsService.getClubMembers / src/lib/emergency-contacts.ts). This is a
// deliberately broader grant than the per-event attendance export — the
// accountability mechanism is the audit log below, not field-level gating.
// Bulk PII export, so it's audit-logged like the event attendee export.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const { id } = await params;
    if (!(await canManageClubMembers(session, id))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const club = await db.query.clubs.findFirst({ where: eq(clubs.id, id), columns: { name: true } });
    if (!club) {
      return NextResponse.json({ error: "Club not found" }, { status: 404 });
    }

    const members = await ClubsService.getClubMembersFull(id);

    const fmtContacts = (contacts: { relationship: string; phone: string }[]) =>
      contacts.map((c) => `${c.relationship}: ${c.phone}`).join("; ");

    const header = [
      "Name", "Nickname", "Student ID", "Major", "Phone", "Contact Channels",
      "House", "Club Role", "Position",
      "Chronic Diseases", "Medical History", "Drug Allergies", "Food Allergies",
      "Dietary Restrictions", "Fainting History", "Emergency Medication", "Emergency Contacts",
    ];
    const rows = members.map((m) => ({
      "Name": m.userName || "",
      "Nickname": m.nickname || "",
      "Student ID": m.studentId || "",
      "Major": m.major || "",
      "Phone": m.phone || "",
      "Contact Channels": m.contactChannels || "",
      "House": canonicalHouseName(m.house),
      "Club Role": m.role === "president" ? "President" : "Member",
      "Position": m.position ? (POSITION_LABEL_EN[m.position as PositionId] ?? m.position) : "",
      "Chronic Diseases": m.chronicDiseases || "",
      "Medical History": m.medicalHistory || "",
      "Drug Allergies": m.drugAllergies || "",
      "Food Allergies": m.foodAllergies || "",
      "Dietary Restrictions": m.dietaryRestrictions || "",
      "Fainting History": m.faintingHistory ? "Yes" : "",
      "Emergency Medication": m.emergencyMedication || "",
      "Emergency Contacts": fmtContacts(m.emergencyContacts),
    }));

    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(rows, { header });
    ws["!autofilter"] = { ref: ws["!ref"] || "A1" };
    ws["!cols"] = header.map((h) => ({ wch: Math.min(40, Math.max(12, h.length + 2)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Members");
    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    await AuditService.logAction({
      actorId: session!.user!.id!,
      targetId: formatAuditTargetList(members.map((m) => ({ name: m.userName, studentId: m.studentId }))),
      action: `Exported club member XLSX for "${club.name}" (${id}) — ${members.length} member(s), included medical detail + emergency contacts (relationship/phone only)`,
      ipAddress: getClientIp(req),
    });

    const sanitize = (s: string) =>
      s.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_").replace(/^_+|_+$/g, "");
    const safeName = sanitize(club.name || "club").slice(0, 40) || "club";
    const fileName = `members_${safeName}.xlsx`;
    const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_");

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Failed to export club members XLSX:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
