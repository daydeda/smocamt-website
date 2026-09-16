import { auth } from "@/auth";
import { db } from "@/db";
import { events, eventSessions, attendance } from "@/db/schema";
import { EvidenceCheckinService } from "@/modules/events/evidence-checkin.service";
import { getEvidenceWindowStatus } from "@/lib/evidence-checkin";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

// A stored file key is always "<uuid>.<ext>" (see uploadFormFile in
// src/lib/form-file-storage.ts, reused as-is for evidence uploads via the
// existing /api/forms/upload endpoint) — reject anything else so this can
// only ever point at an object this app minted.
const FILE_KEY_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]+$/i;

const REASON_MESSAGES: Record<string, string> = {
  wrong_mode: "This event does not use evidence check-in.",
  not_configured: "This session has no code word configured yet — ask an organizer to set one.",
  upcoming: "This session hasn't opened for evidence submission yet.",
  closed: "The submission window for this session has closed.",
  invalid_code: "That code word doesn't match today's — double-check today's announcement.",
};

// GET /api/events/[id]/evidence-checkin — the event's evidence-mode sessions
// for the signed-in student to fill in: per session, the (organizer-set)
// prompt, whether its window is currently open, and whether this student has
// already submitted for it. The code word (evidenceNonce) is deliberately
// NEVER included in this response — it's checked server-side on submit only.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: eventId } = await params;
    const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    if (event.checkInMode !== "evidence") {
      return NextResponse.json({ error: "This event does not use evidence check-in." }, { status: 400 });
    }

    const sessions = await db.query.eventSessions.findMany({
      where: eq(eventSessions.eventId, eventId),
      orderBy: (s, { asc }) => [asc(s.sortOrder), asc(s.startTime)],
    });

    const mySubmissions = await db.query.attendance.findMany({
      where: and(eq(attendance.eventId, eventId), eq(attendance.studentId, session.user.id)),
    });
    const bySession = new Map(mySubmissions.map((a) => [a.sessionId, a]));

    return NextResponse.json({
      eventId: event.id,
      eventTitle: event.title,
      individualPointsAwarded: event.individualPointsAwarded ?? 0,
      sessions: sessions.map((s) => {
        const mine = bySession.get(s.id);
        const submitted = mine?.status === "attended";
        return {
          sessionId: s.id,
          title: s.title,
          startTime: s.startTime,
          endTime: s.endTime,
          evidencePrompt: s.evidencePrompt,
          windowStatus: getEvidenceWindowStatus(s),
          submitted,
          submittedAt: submitted ? mine!.checkInTime : null,
          // For the "view what I submitted" link (GET /api/attendance/evidence/…).
          attendanceId: submitted ? mine!.id : null,
        };
      }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Evidence check-in list error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/events/[id]/evidence-checkin — a student's self-submitted proof
// (photo + that day's code word) for one session of an evidence-mode event.
// Uploads a fresh attendance row directly as 'attended' (method: 'evidence')
// and awards that session's individual points, exactly like a QR/walk-in
// check-in — see EvidenceCheckinService.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Nonce-guessing resistance: a handful of attempts is plenty for a real
    // typo, far too few to brute-force a short word.
    const ip = getClientIp(req);
    const limiter = await rateLimit(ip, 10, 60000);
    if (!limiter.success) {
      return NextResponse.json(
        { error: "Too many attempts. Please slow down." },
        { status: 429, headers: { "Retry-After": Math.ceil((limiter.resetTime - Date.now()) / 1000).toString() } },
      );
    }

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: eventId } = await params;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { sessionId, nonce, fileKey } = body as Record<string, unknown>;

    if (typeof sessionId !== "string" || !sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    if (typeof nonce !== "string" || !nonce.trim()) {
      return NextResponse.json({ error: "Please enter today's code word." }, { status: 400 });
    }
    if (typeof fileKey !== "string" || !FILE_KEY_PATTERN.test(fileKey)) {
      return NextResponse.json({ error: "Please attach your evidence photo/PDF." }, { status: 400 });
    }

    const result = await EvidenceCheckinService.submit({
      eventId,
      sessionId,
      studentId: session.user.id,
      submittedNonce: nonce,
      fileKey,
    });

    switch (result.status) {
      case "success":
        return NextResponse.json({ success: true, checkedInAt: result.checkedInAt });
      case "already_checked_in":
        return NextResponse.json({ error: "You've already submitted evidence for this session." }, { status: 400 });
      case "not_found":
        return NextResponse.json({ error: "Event or session not found." }, { status: 404 });
      case "ineligible":
        return NextResponse.json({ error: REASON_MESSAGES[result.reason] ?? "Submission not allowed." }, { status: 400 });
      default:
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
  } catch (error) {
    console.error("Evidence check-in error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
