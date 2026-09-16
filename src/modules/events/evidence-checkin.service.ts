// Evidence-based check-in (events.checkInMode === 'evidence'): a student
// self-submits proof for a session instead of being QR/manual/walk-in scanned.
// This mirrors the walk-in path in scanner.service.ts as closely as possible
// (same attendance-row shape, same awardIndividualPoints call, same isStaff/
// sessionLabel conventions) so evidence check-ins behave identically to QR
// ones everywhere downstream — house points at event-end, attendance exports,
// no-show strikes, the multi-day points policy. See
// docs/features/evidence-checkin.md.
import { db } from "@/db";
import { attendance, events, eventSessions, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { awardIndividualPoints } from "@/lib/award-individual-points";
import { checkEvidenceEligibility, type EvidenceEligibility } from "@/lib/evidence-checkin";

type EvidenceIneligibleReason = Extract<EvidenceEligibility, { ok: false }>["reason"];

export type EvidenceCheckinResult =
  | { status: "success"; checkedInAt: Date }
  | { status: "already_checked_in"; checkedInAt: Date | null }
  | { status: "not_found" }
  | { status: "ineligible"; reason: EvidenceIneligibleReason };

export class EvidenceCheckinService {
  static async submit(params: {
    eventId: string;
    sessionId: string;
    studentId: string;
    submittedNonce: string;
    fileKey: string;
  }): Promise<EvidenceCheckinResult> {
    const { eventId, sessionId, studentId, submittedNonce, fileKey } = params;

    const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
    if (!event) return { status: "not_found" };

    const session = await db.query.eventSessions.findFirst({
      where: and(eq(eventSessions.id, sessionId), eq(eventSessions.eventId, eventId)),
    });
    if (!session) return { status: "not_found" };

    const eligibility = checkEvidenceEligibility({ event, session, submittedNonce });
    if (!eligibility.ok) return { status: "ineligible", reason: eligibility.reason };

    const student = await db.query.users.findFirst({ where: eq(users.id, studentId) });
    if (!student) return { status: "not_found" };

    // Already done for THIS session (day) — one row per (sessionId, studentId),
    // same uniqueness the QR/walk-in paths rely on.
    const existing = await db.query.attendance.findFirst({
      where: and(eq(attendance.sessionId, sessionId), eq(attendance.studentId, studentId)),
    });
    if (existing?.status === "attended") {
      return { status: "already_checked_in", checkedInAt: existing.checkInTime };
    }

    const isEventStaff = Array.isArray(event.staffUserIds) && event.staffUserIds.includes(studentId);
    const sessionLabel = session.title?.trim() || "this session";
    const individualPoints = event.individualPointsAwarded ?? 0;
    const checkedInAt = new Date();

    await db.transaction(async (tx) => {
      if (existing) {
        // A row already exists (e.g. 'registered' from some other flow) —
        // flip it to attended rather than inserting a duplicate.
        await tx
          .update(attendance)
          .set({
            status: "attended",
            checkInTime: checkedInAt,
            method: "evidence",
            evidenceFileKey: fileKey,
            evidenceNonceSubmitted: submittedNonce,
          })
          .where(eq(attendance.id, existing.id));
      } else {
        await tx.insert(attendance).values({
          eventId,
          sessionId,
          studentId,
          method: "evidence",
          status: "attended",
          checkInTime: checkedInAt,
          evidenceFileKey: fileKey,
          evidenceNonceSubmitted: submittedNonce,
          isStaff: isEventStaff,
        });
      }

      // Staff self-submitting evidence are exempt from earning points for it,
      // same as a staff walk-in — they're working the event/challenge, not a
      // participant in the points contest.
      if (!isEventStaff && individualPoints > 0) {
        await awardIndividualPoints(tx, {
          studentId: student.id,
          studentName: student.name,
          houseId: student.houseId,
          eventId,
          points: individualPoints,
          reason: `Awarded ${individualPoints} individual points to ${student.name} for submitting evidence for "${event.title}" (${sessionLabel})`,
          activityLabel: event.title,
        });
      }
    });

    return { status: "success", checkedInAt };
  }
}
