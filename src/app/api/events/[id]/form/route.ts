import { auth } from "@/auth";
import { db } from "@/db";
import { forms, formSubmissions, attendance, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { awardIndividualPoints } from "@/lib/points/award-individual-points";
import { NextResponse } from "next/server";
import {
  normalizeForm,
  computeScore,
  getVisitedSectionIndices,
  isQuestionVisible,
  type AnswerMap,
} from "@/lib/forms/form-schema";
import { canAccessSkillForm, getFormAvailability } from "@/lib/access/form-access";
import { revalidateLeaderboards } from "@/lib/points/leaderboard-cache";

// A "file" answer must be an app-minted storage key ("<uuid>.<ext>"); mirrors the
// pattern in /api/forms/file and /api/forms/upload so a forged value is rejected.
const FILE_KEY_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]+$/i;

// GET /api/events/[id]/form — fetch all relevant forms for a student
// S-type forms are excluded for non-admin users.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: eventId } = await params;
    const userId = session.user.id!;
    const userRole = session.user.role || "";

    // Attendance is one row PER SESSION (a 2-day event has 2 rows per student),
    // so check for the EXISTENCE of any session this student actually attended —
    // not findFirst-then-status, which returns an arbitrary session (e.g. a still-
    // "registered" day 1) and would wrongly report hasAttended=false for someone
    // who checked in on day 2. Mirrors the POST submit gate below. Checking in on
    // any single day is enough to open and submit the form.
    const attRecord = await db.query.attendance.findFirst({
      where: and(
        eq(attendance.eventId, eventId),
        eq(attendance.studentId, userId),
        eq(attendance.status, "attended"),
      ),
    });
    const hasAttended = !!attRecord;

    const allForms = await db.query.forms.findMany({
      where: eq(forms.eventId, eventId),
      orderBy: (f, { asc }) => [asc(f.sortOrder), asc(f.createdAt)],
    });

    // S forms are gated by assignment (role/person + managers); other forms are
    // visible to everyone.
    const viewer = { id: userId, role: userRole };
    const visibleForms = allForms.filter((f) => f.formType !== "S" || canAccessSkillForm(f, viewer));

    const formResponses = await Promise.all(
      visibleForms.map(async (formObj) => {
        const existingSubmission = await db.query.formSubmissions.findFirst({
          where: and(
            eq(formSubmissions.formId, formObj.id),
            eq(formSubmissions.studentId, userId)
          ),
        });

        let result: { score: number; maxScore: number; hasGraded: boolean } | null = null;
        if (existingSubmission) {
          const { score, maxScore, hasGraded } = computeScore(
            normalizeForm(formObj.questions),
            (existingSubmission.answers as AnswerMap) || {}
          );
          if (hasGraded) result = { score, maxScore, hasGraded };
        }

        return {
          id: formObj.id,
          eventId: formObj.eventId,
          formType: formObj.formType,
          sortOrder: formObj.sortOrder,
          title: formObj.title,
          description: formObj.description,
          questions: formObj.questions,
          pointsAwarded: formObj.pointsAwarded,
          individualPointsAwarded: formObj.individualPointsAwarded,
          isActive: formObj.isActive,
          isAwarded: formObj.isAwarded,
          opensAt: formObj.opensAt,
          closesAt: formObj.closesAt,
          availability: getFormAvailability(formObj),
          hasSubmitted: !!existingSubmission,
          answers: existingSubmission?.answers || null,
          result,
        };
      })
    );

    return NextResponse.json({ forms: formResponses, hasAttended });
  } catch (error) {
    console.error("Failed to fetch student forms:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/events/[id]/form — student submits answers to a specific form
// Body: { formId: string, answers: AnswerMap }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: eventId } = await params;
    const userId = session.user.id!;
    const userRole = session.user.role || "";
    const { formId, answers } = await req.json();

    if (!formId) {
      return NextResponse.json({ error: "formId is required" }, { status: 400 });
    }
    if (!answers || typeof answers !== "object") {
      return NextResponse.json({ error: "Missing or invalid answers" }, { status: 400 });
    }

    const formObj = await db.query.forms.findFirst({
      where: and(eq(forms.id, formId), eq(forms.eventId, eventId)),
    });

    if (!formObj) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }

    // S forms are restricted to assigned people (by role/person) + managers.
    if (formObj.formType === "S" && !canAccessSkillForm(formObj, { id: userId, role: userRole })) {
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    }

    // Schedule-aware gate: finalized (awarded), not yet open, or past close.
    const availability = getFormAvailability(formObj);
    if (availability === "awarded") {
      return NextResponse.json({ error: "The contest has finalized and this form is permanently locked." }, { status: 400 });
    }
    if (availability === "upcoming") {
      return NextResponse.json({ error: "This form is not open yet. Please come back when it opens." }, { status: 400 });
    }
    if (availability !== "open") {
      return NextResponse.json({ error: "This form is closed." }, { status: 400 });
    }

    // K_pre (pre-test) and S (skill — filled by assigned evaluators, not attendees)
    // skip the attendance check; all others require physical check-in.
    //
    // Attendance is one row PER SESSION (a 2-day event has 2 rows per student),
    // so we check for the EXISTENCE of any session this student actually
    // attended — not findFirst-then-status, which returns an arbitrary session
    // (e.g. a still-"registered" day 2) and would wrongly reject someone who
    // checked in on day 1. Checking in on any single day is enough to submit.
    if (formObj.formType !== "K_pre" && formObj.formType !== "S") {
      const attRecord = await db.query.attendance.findFirst({
        where: and(
          eq(attendance.eventId, eventId),
          eq(attendance.studentId, userId),
          eq(attendance.status, "attended"),
        ),
      });
      if (!attRecord) {
        return NextResponse.json({
          error: "You must have checked in and physically attended this event to submit this form.",
        }, { status: 403 });
      }
    }

    const existingSubmission = await db.query.formSubmissions.findFirst({
      where: and(eq(formSubmissions.formId, formObj.id), eq(formSubmissions.studentId, userId)),
    });
    if (existingSubmission) {
      return NextResponse.json({ error: "You have already completed this form." }, { status: 400 });
    }

    // 3b. Server-side required-field validation. The client enforces this too, but a
    // raw POST could send {} and still count toward the house submission contest.
    // Only validate questions actually on the student's branch path and visible.
    const normalized = normalizeForm(formObj.questions);
    const answerMap = answers as AnswerMap;
    const isBlank = (v: unknown) =>
      v === undefined || v === null ||
      (typeof v === "string" && v.trim() === "") ||
      (Array.isArray(v) && v.length === 0);

    for (const idx of getVisitedSectionIndices(normalized, answerMap)) {
      for (const q of normalized.sections[idx].questions) {
        if (!isQuestionVisible(q, answerMap)) continue;
        if (q.required && isBlank(answerMap[q.id])) {
          return NextResponse.json(
            { error: "Please answer all required questions before submitting." },
            { status: 400 }
          );
        }
        // A "file" answer is an opaque storage key this app minted ("<uuid>.<ext>").
        // The POST body is otherwise stored verbatim, so without this a raw request
        // could plant a forged or foreign string that later surfaces as a broken /
        // cross-pointing link in the admin viewer and export. (Cross-user reuse is
        // already infeasible — keys are unguessable random UUIDs — so format is the
        // gap worth closing here.)
        if (q.type === "file") {
          const v = answerMap[q.id];
          if (!isBlank(v) && (typeof v !== "string" || !FILE_KEY_PATTERN.test(v))) {
            return NextResponse.json({ error: "Invalid file answer." }, { status: 400 });
          }
        }
      }
    }

    // 4. Record the submission, and (if the form grants any) award the submitter
    // their individual points — atomically in one transaction. The (form_id,
    // student_id) unique index is the authoritative guard against a double-submit
    // race: the second insert throws 23505, the whole transaction rolls back, and
    // no points are awarded, so a duplicate submit can never double-award.
    const individualPoints = formObj.individualPointsAwarded ?? 0;
    try {
      await db.transaction(async (tx) => {
        await tx.insert(formSubmissions).values({ formId: formObj.id, studentId: userId, answers });

        if (individualPoints > 0) {
          const submitter = await tx.query.users.findFirst({
            where: eq(users.id, userId),
            columns: { name: true, houseId: true },
          });
          const submitterName = submitter?.name ?? "Student";
          await awardIndividualPoints(tx, {
            studentId: userId,
            studentName: submitterName,
            houseId: submitter?.houseId ?? null,
            // Tagged with eventId only (never formId) so a form re-open's award
            // clawback leaves these permanent individual points untouched.
            eventId,
            points: individualPoints,
            reason: `Awarded ${individualPoints} individual points to ${submitterName} for completing form "${formObj.title}"`,
            activityLabel: formObj.title,
          });
        }
      });
    } catch (e) {
      const dbError = (e as { cause?: { code?: string }; code?: string })?.cause ?? (e as { code?: string });
      if (dbError?.code === "23505") {
        return NextResponse.json({ error: "You have already completed this form." }, { status: 409 });
      }
      throw e;
    }

    // Bust the cached leaderboard so an individual-points award shows up on the
    // next poll instead of waiting out the cache TTL.
    if (individualPoints > 0) {
      revalidateLeaderboards();
    }

    const { score, maxScore, hasGraded } = computeScore(normalizeForm(formObj.questions), answers as AnswerMap);

    return NextResponse.json({
      success: true,
      result: hasGraded ? { score, maxScore, hasGraded } : null,
    });
  } catch (error) {
    console.error("Failed to submit student form:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
