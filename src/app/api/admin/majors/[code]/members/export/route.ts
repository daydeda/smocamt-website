import { auth } from "@/auth";
import { effectiveRoles } from "@/lib/admin-access";
import { POSITION_LABEL_EN, type PositionId } from "@/lib/positions";
import { EventScopeService } from "@/modules/events/event-scope.service";
import { MajorsService } from "@/modules/majors/majors.service";
import { formatAuditTargetList } from "@/lib/audit-target-list";
import { NextResponse } from "next/server";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { canonicalHouseName } from "@/lib/faculties";

// xlsx is a CommonJS package — keep this route on the Node.js runtime.
export const runtime = "nodejs";

// GET /api/admin/majors/[code]/members/export — the major's roster as a real
// .xlsx. Same fields as GET .../members: identity, contact, house, position,
// AND medical detail + emergency contacts (relationship + phone only — the
// contact's own name is redacted at the DB layer, see
// MajorsService.getMajorMembers / src/lib/emergency-contacts.ts). This is a
// deliberately broader grant than the per-event attendance export — the
// accountability mechanism is the audit log below, not field-level gating.
// Gate: super_admin/admin, OR a major_president viewing THEIR OWN major
// (verified server-side via EventScopeService.getPresidentScope — never trust
// the client-supplied :code alone). Bulk PII export, so it's audit-logged
// like the event attendee export.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { code } = await params;
    const isAdminRole = ["super_admin", "admin"].includes(session.user.role || "");

    if (!isAdminRole) {
      const myRoles = effectiveRoles(session.user.role, session.user.roles);
      const scope = await EventScopeService.getPresidentScope(session.user.id!, myRoles);
      if (!scope.majors.includes(code)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const members = await MajorsService.getMajorMembersFull(code);

    const fmtContacts = (contacts: { relationship: string; phone: string }[]) =>
      contacts.map((c) => `${c.relationship}: ${c.phone}`).join("; ");

    const header = [
      "Name", "Nickname", "Student ID", "Phone", "Contact Channels", "House", "Position",
      "Chronic Diseases", "Medical History", "Drug Allergies", "Food Allergies",
      "Dietary Restrictions", "Fainting History", "Emergency Medication", "Emergency Contacts",
    ];
    const rows = members.map((m) => ({
      "Name": m.name || "",
      "Nickname": m.nickname || "",
      "Student ID": m.studentId || "",
      "Phone": m.phone || "",
      "Contact Channels": m.contactChannels || "",
      "House": canonicalHouseName(m.house),
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
      actorId: session.user.id!,
      targetId: formatAuditTargetList(members.map((m) => ({ name: m.name, studentId: m.studentId }))),
      action: `Exported major team XLSX for major ${code} — ${members.length} member(s), included medical detail + emergency contacts (relationship/phone only)`,
      ipAddress: getClientIp(req),
    });

    const fileName = `members_${code.replace(/[^a-zA-Z0-9_-]/g, "_")}.xlsx`;

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Failed to export major members XLSX:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
