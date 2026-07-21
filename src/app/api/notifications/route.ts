import { auth } from "@/auth";
import { db } from "@/db";
import { attendance, auditLogs, events, forms, formSubmissions } from "@/db/schema";
import { and, desc, eq, gt, inArray, like, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// Fail fast instead of hanging to the platform default if the DB pooler stalls.
export const maxDuration = 20;

// How far back we will ever look. A returning student who was away for a while
// should not get a flood of stale pop-ups, and bounding the window keeps both
// queries cheap (they ride the timestamp / check-in-time indexes).
const MAX_LOOKBACK_MS = 5 * 60 * 1000;
// When the client has no last-seen marker yet (fresh device / first load), only
// surface the last minute and a half so a check-in that just happened is still
// caught by the immediate-on-mount poll, without replaying history.
const COLD_START_MS = 90 * 1000;

// Per-student scores are not stored row-per-student anywhere except the audit
// log (score_history is house-level with no studentId). We match the exact
// wording ScannerService writes so only individual-score events are surfaced,
// then parse the delta + activity title — never returning the raw action text
// (it can contain staff-entered reason notes).
const SCORE_ACTION = /^(Awarded|Deducted) (\d+) individual points to .* for activity "(.+?)"/;

type Notification = {
  id: string;
  type: "checkin" | "score" | "pre_test_reminder";
  at: string;
  eventTitle: string | null;
  points?: number;
  // Deep-link to act on the notification (pre_test_reminder → the K_pre form).
  link?: string;
  // Set on a checkin notification when the event is mirrored into Songsue —
  // drives the client's "see your house color on Songsue" redirect prompt.
  songsueLinked?: boolean;
};

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const now = Date.now();
    const floor = new Date(now - MAX_LOOKBACK_MS);
    let since = new Date(now - COLD_START_MS);
    const sinceParam = req.nextUrl.searchParams.get("since");
    if (sinceParam) {
      const parsed = new Date(sinceParam);
      // Clamp the client's marker to the lookback floor so a long-stale marker
      // can't widen the scan, and ignore an unparseable value.
      if (!Number.isNaN(parsed.getTime())) {
        since = parsed > floor ? parsed : floor;
      }
    }

    const [checkins, scores] = await Promise.all([
      db
        .select({
          id: attendance.id,
          eventId: attendance.eventId,
          checkInTime: attendance.checkInTime,
          eventTitle: events.title,
          songsueLinked: events.songsueLinked,
        })
        .from(attendance)
        .innerJoin(events, eq(events.id, attendance.eventId))
        .where(
          and(
            eq(attendance.studentId, userId),
            eq(attendance.status, "attended"),
            gt(attendance.checkInTime, since),
          ),
        )
        .orderBy(desc(attendance.checkInTime))
        .limit(20),
      db
        .select({
          id: auditLogs.id,
          timestamp: auditLogs.timestamp,
          action: auditLogs.action,
        })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.targetId, userId),
            gt(auditLogs.timestamp, since),
            or(
              like(auditLogs.action, "Awarded %individual points%"),
              like(auditLogs.action, "Deducted %individual points%"),
            ),
          ),
        )
        .orderBy(desc(auditLogs.timestamp))
        .limit(20),
    ]);

    const notifications: Notification[] = [];

    for (const c of checkins) {
      if (!c.checkInTime) continue;
      notifications.push({
        id: `ci:${c.id}`,
        type: "checkin",
        at: c.checkInTime.toISOString(),
        eventTitle: c.eventTitle ?? null,
        songsueLinked: c.songsueLinked,
      });
    }

    // Pre-test (K_pre) reminders. Walk-ins are checked in without ever passing the
    // dashboard pre-test gate, so for any event a student just attended that still
    // has an outstanding pre-test, nudge them — with a deep-link — while they're on
    // the Digital ID page presenting their QR. Derived live (no table), keyed to the
    // recent check-in window like the other notifications.
    const eventIds = [...new Set(checkins.map((c) => c.eventId).filter(Boolean))] as string[];
    if (eventIds.length > 0) {
      const preTests = await db
        .select({
          id: forms.id,
          eventId: forms.eventId,
          isActive: forms.isActive,
          closesAt: forms.closesAt,
        })
        .from(forms)
        .where(and(inArray(forms.eventId, eventIds), eq(forms.formType, "K_pre")));

      // Only forms that can still be taken: manually active and not past their close.
      const takeable = preTests.filter(
        (f) => f.isActive !== false && (!f.closesAt || f.closesAt.getTime() >= now),
      );

      if (takeable.length > 0) {
        const submitted = await db
          .select({ formId: formSubmissions.formId })
          .from(formSubmissions)
          .where(
            and(
              eq(formSubmissions.studentId, userId),
              inArray(
                formSubmissions.formId,
                takeable.map((f) => f.id),
              ),
            ),
          );
        const submittedSet = new Set(submitted.map((s) => s.formId));

        // Most-recent check-in per event (checkins are ordered by check-in time desc)
        // gives the reminder its timestamp + event title.
        const checkinByEvent = new Map<string, { at: string; title: string | null }>();
        for (const c of checkins) {
          if (!c.checkInTime || !c.eventId || checkinByEvent.has(c.eventId)) continue;
          checkinByEvent.set(c.eventId, { at: c.checkInTime.toISOString(), title: c.eventTitle ?? null });
        }

        for (const f of takeable) {
          if (submittedSet.has(f.id)) continue;
          const ci = checkinByEvent.get(f.eventId);
          if (!ci) continue;
          notifications.push({
            id: `pt:${f.id}`,
            type: "pre_test_reminder",
            at: ci.at,
            eventTitle: ci.title,
            link: `/dashboard/history?form=${f.id}&event=${f.eventId}`,
          });
        }
      }
    }

    for (const s of scores) {
      const m = s.action.match(SCORE_ACTION);
      if (!m || !s.timestamp) continue;
      const points = m[1] === "Deducted" ? -Number(m[2]) : Number(m[2]);
      notifications.push({
        id: `sc:${s.id}`,
        type: "score",
        at: s.timestamp.toISOString(),
        eventTitle: m[3] ?? null,
        points,
      });
    }

    notifications.sort((a, b) => a.at.localeCompare(b.at));

    return NextResponse.json(
      { serverTime: new Date(now).toISOString(), notifications },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to fetch notifications:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
