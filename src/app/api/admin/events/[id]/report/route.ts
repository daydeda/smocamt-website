import { auth } from "@/auth";
import { db } from "@/db";
import { attendance, eventSessions, events } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { EventScopeService } from "@/modules/events/event-scope.service";
import { isEventUnscopedStaff } from "@/lib/admin-access";

// xlsx is a CommonJS package — keep this route on the Node.js runtime.
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const myRoles = session?.user?.roles ?? (session?.user?.role ? [session.user.role] : []);
    const smoPosition = session?.user?.smoPosition;
    const anusmoPosition = session?.user?.anusmoPosition;
    const isRoleAdmin = myRoles.some((r) => ["super_admin", "admin", "registration", "organizer", "smo", "club_president", "major_president"].includes(r));
    const isAdminRole = isRoleAdmin || (!!session?.user?.id
      && (await EventScopeService.hasRegistrationScope(session.user.id, myRoles, smoPosition, anusmoPosition)));
    if (!session?.user || !isAdminRole) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: eventId } = await params;

    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { id: true, title: true, managedByRoles: true, ownerClubIds: true, ownerMajors: true },
    });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Event scoping for president roles (mirrors the /api/admin/events list filter
    // and the attendance route): club_president / major_president, and a
    // club/major-scoped registration position, may only export events they OWN
    // (ownerClubIds/ownerMajors). Staff, smo, and a GLOBAL registration position
    // are unscoped.
    const isStaff = isEventUnscopedStaff(myRoles, smoPosition, anusmoPosition);
    const presidentTags = myRoles.filter((r) => ["club_president", "major_president"].includes(r));
    const hasPresidentTag = presidentTags.length > 0;
    // Bare smo (no president tag, no registration position) stays unscoped —
    // unchanged from before. Presidents and a club/major-scoped registration
    // position are the only ones actually scoped here.
    const hasRegistrationScope = !isStaff && !hasPresidentTag && !!session?.user?.id
      && (await EventScopeService.hasRegistrationScope(session.user.id, myRoles, smoPosition, anusmoPosition));
    if (!isStaff && (hasPresidentTag || hasRegistrationScope)) {
      const access = await EventScopeService.resolveEventAccess({
        userId: session.user.id!, roles: myRoles, smoPosition, anusmoPosition, isUnscopedStaff: false, hasPresidentTag,
      });
      const managed = access.allowed && (access.unscoped || EventScopeService.isEventManagedByScope(event, access.scope));
      if (!managed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // This report is reachable by scanner-only roles (smo) and registration/
    // organizer, so it deliberately pulls NO medical detail — only the roster
    // fields below.
    const allAttendance = await db.query.attendance.findMany({
      where: eq(attendance.eventId, eventId),
      with: {
        user: { columns: { studentId: true, name: true, nickname: true } },
        session: { columns: { id: true, title: true, sortOrder: true } },
      },
    });

    // Defensive cap: the whole roster + the xlsx buffer are built in memory (xlsx
    // can't stream). Per-event this is bounded, but refuse a pathologically large
    // report rather than risk OOM.
    const MAX_EXPORT_ROWS = 50000;
    if (allAttendance.length > MAX_EXPORT_ROWS) {
      return NextResponse.json(
        { error: `This report is too large (${allAttendance.length} rows).` },
        { status: 413 }
      );
    }

    // Bulk PII export: keep a tamper-evident record of who pulled it (PDPA).
    await AuditService.logAction({
      actorId: session.user.id!,
      action: `Exported attendance report XLSX for event "${event.title}" (${eventId}) (${allAttendance.length} rows)`,
      ipAddress: getClientIp(req),
    });

    const fmtTime = (d: Date | null) =>
      d ? d.toLocaleString("en-GB", { timeZone: "Asia/Bangkok" }) : "";
    const buildRow = (a: (typeof allAttendance)[number]): Record<string, string> => ({
      "Student ID": a.user?.studentId || "N/A",
      "Name": a.user?.name || "",
      "Nickname": a.user?.nickname || "",
      "Method": a.method || "",
      "Status": a.status === "attended" ? "Checked In" : a.status || "",
      "Check-in Time": fmtTime(a.checkInTime),
    });
    const header = ["Student ID", "Name", "Nickname", "Method", "Status", "Check-in Time"];

    // One worksheet per day. Enumerate sessions so even days with no check-ins
    // still get a (header-only) sheet; attendance with no/unknown session falls
    // into an "Unassigned" sheet.
    const sessions = await db.query.eventSessions.findMany({
      where: eq(eventSessions.eventId, eventId),
      columns: { id: true, title: true, sortOrder: true },
      orderBy: (s, { asc }) => [asc(s.sortOrder), asc(s.startTime)],
    });
    // Group raw attendance by day so the per-day sheets and the per-day summary
    // are both derived from the same source.
    type Att = (typeof allAttendance)[number];
    const rawBySession = new Map<string, Att[]>();
    const rawOrphans: Att[] = [];
    for (const a of allAttendance) {
      const sid = a.sessionId;
      if (sid && sessions.some((s) => s.id === sid)) {
        const arr = rawBySession.get(sid) ?? [];
        arr.push(a);
        rawBySession.set(sid, arr);
      } else {
        rawOrphans.push(a);
      }
    }
    type DayGroup = { label: string; rows: Att[] };
    const dayGroups: DayGroup[] = sessions.map((s) => ({
      label: s.title?.trim() || `Day ${s.sortOrder + 1}`,
      rows: rawBySession.get(s.id) ?? [],
    }));
    if (rawOrphans.length > 0) dayGroups.push({ label: "Unassigned", rows: rawOrphans });
    // "Multi-day" is keyed off the count of REAL sessions, not the group count, so
    // an event with no sessions (or one session plus legacy null-session rows) is
    // still single-day: one roster sheet holding everyone.
    const isMultiDay = sessions.length > 1;

    // Per-scope tallies, reused for both each day and the event-wide total.
    const statsFor = (rows: Att[]) => {
      const pre = rows.filter((a) => a.method === "pre-registered");
      const preTotal = pre.length;
      const preAttended = pre.filter((a) => a.status === "attended").length;
      const walkIns = rows.filter((a) => a.method === "walk-in").length;
      const noShow = Math.max(0, preTotal - preAttended);
      const checkedIn = rows.filter((a) => a.status === "attended").length;
      const distinct = new Set(rows.map((a) => a.studentId)).size;
      const pct = preTotal > 0 ? (noShow / preTotal) * 100 : 0;
      return { preTotal, preAttended, walkIns, noShow, checkedIn, distinct, pct };
    };

    const XLSX = await import("xlsx");
    const makeSheet = (rows: Record<string, string>[]) => {
      const ws = XLSX.utils.json_to_sheet(rows, { header });
      ws["!autofilter"] = { ref: ws["!ref"] || "A1" };
      ws["!cols"] = header.map((h) => ({ wch: Math.min(40, Math.max(12, h.length + 2)) }));
      return ws;
    };
    // Excel sheet names: ≤31 chars, none of : \ / ? * [ ], unique, non-empty.
    const usedNames = new Set<string>();
    const toSheetName = (label: string) => {
      const base = (label.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31)) || "Day";
      let name = base;
      let i = 2;
      while (usedNames.has(name.toLowerCase())) {
        const suffix = ` (${i++})`;
        name = base.slice(0, 31 - suffix.length) + suffix;
      }
      usedNames.add(name.toLowerCase());
      return name;
    };

    const wb = XLSX.utils.book_new();

    // Summary sheet FIRST so it's the tab people land on. A per-day breakdown for
    // multi-day events, plus an event-wide total row (the only row when single-day).
    const summaryHeader = [
      "Day", "Pre-registered", "Attended", "No-shows", "No-show %",
      "Walk-ins", "Total Checked-in", "Distinct Students",
    ];
    const summaryRowFor = (label: string, rows: Att[]): Record<string, string | number> => {
      const s = statsFor(rows);
      return {
        "Day": label,
        "Pre-registered": s.preTotal,
        "Attended": s.preAttended,
        "No-shows": s.noShow,
        "No-show %": `${s.pct.toFixed(1)}%`,
        "Walk-ins": s.walkIns,
        "Total Checked-in": s.checkedIn,
        "Distinct Students": s.distinct,
      };
    };
    const summaryRows: Record<string, string | number>[] = [];
    if (isMultiDay) {
      for (const g of dayGroups) summaryRows.push(summaryRowFor(g.label, g.rows));
    }
    summaryRows.push(summaryRowFor(isMultiDay ? "ALL DAYS (total)" : "Total", allAttendance));
    const summaryWs = XLSX.utils.json_to_sheet(summaryRows, { header: summaryHeader });
    summaryWs["!autofilter"] = { ref: summaryWs["!ref"] || "A1" };
    summaryWs["!cols"] = summaryHeader.map((h) => ({ wch: Math.max(14, h.length + 2) }));
    XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

    // Then the roster sheet(s): one per day for multi-day events, else a single
    // "Attendees" sheet holding everyone (use allAttendance so no orphan row is lost).
    if (!isMultiDay) {
      XLSX.utils.book_append_sheet(wb, makeSheet(allAttendance.map(buildRow)), "Attendees");
    } else {
      for (const g of dayGroups) {
        XLSX.utils.book_append_sheet(wb, makeSheet(g.rows.map(buildRow)), toSheetName(g.label));
      }
    }

    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    // Keep Thai/Unicode in the filename via RFC 5987 filename*, ASCII fallback.
    const safeTitle =
      (event.title || "event")
        .replace(/[\\/:*?"<>|]+/g, "")
        .replace(/\s+/g, "_")
        .slice(0, 40)
        .replace(/^_+|_+$/g, "") || "event";
    const fileName = `report_${safeTitle}.xlsx`;
    const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_");

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
