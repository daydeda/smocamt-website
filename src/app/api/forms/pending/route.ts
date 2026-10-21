import { auth } from "@/auth";
import { FormsService } from "@/modules/forms/forms.service";
import { isFormOpenForSubmission, canAccessSkillForm } from "@/lib/access/form-access";
import { NextResponse } from "next/server";

// Fail fast instead of hanging to the platform default if the DB pooler stalls.
export const maxDuration = 20;

type PendingForm = {
  formId: string;
  eventId: string;
  eventTitle: string | null;
  formType: string;
  title: string;
};

/**
 * Forms the signed-in student still OWES — drives the persistent "forms to
 * complete" banner. A form is outstanding when it's currently open for submission,
 * the student hasn't submitted it, and they're actually able to submit it:
 *   - K_pre : any event they've joined (registered or attended) — no check-in needed.
 *   - K_post / A (attitude) / F (feedback) : only events they've ATTENDED (mirrors
 *     the submit gate in /api/events/[id]/form — these require a physical check-in).
 *   - S (skill) : evaluator-only; included solely when assigned to this user.
 * Reads form metadata only — no medical data, no audit log required.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const role = session.user.role ?? null;

    // Events the student is part of, and which of those they've actually attended.
    const atts = await FormsService.listAttendanceStatusesForStudent(userId);

    const involved = new Set<string>();
    const attended = new Set<string>();
    for (const a of atts) {
      if (!a.eventId) continue;
      involved.add(a.eventId);
      if (a.status === "attended") attended.add(a.eventId);
    }
    const involvedIds = [...involved];
    if (involvedIds.length === 0) {
      return NextResponse.json({ forms: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const eventForms = await FormsService.listFormsForEvents(involvedIds);

    // Keep only forms that are open AND this student is actually allowed to submit now.
    const candidates = eventForms.filter((f) => {
      if (!isFormOpenForSubmission(f)) return false;
      if (f.formType === "S") return canAccessSkillForm(f, { id: userId, role });
      if (f.formType === "K_pre") return true; // no attendance required
      return attended.has(f.eventId); // K_post / A (attitude) / F (feedback) need a check-in
    });
    if (candidates.length === 0) {
      return NextResponse.json({ forms: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const subs = await FormsService.listSubmissionsForStudent(
      userId,
      candidates.map((f) => f.id),
    );
    const submitted = new Set(subs.map((s) => s.formId));

    const evs = await FormsService.listEventTitles(
      [...new Set(candidates.map((f) => f.eventId))],
    );
    const titleById = new Map(evs.map((e) => [e.id, e.title]));

    const pending: PendingForm[] = [];
    for (const f of candidates) {
      if (submitted.has(f.id)) continue;
      pending.push({
        formId: f.id,
        eventId: f.eventId,
        eventTitle: titleById.get(f.eventId) ?? null,
        formType: f.formType,
        title: f.title,
      });
    }

    // Most urgent first: soonest close date, then forms with no close date.
    pending.sort((a, b) => {
      const fa = candidates.find((f) => f.id === a.formId);
      const fb = candidates.find((f) => f.id === b.formId);
      const ca = fa?.closesAt ? new Date(fa.closesAt).getTime() : Infinity;
      const cb = fb?.closesAt ? new Date(fb.closesAt).getTime() : Infinity;
      return ca - cb;
    });

    return NextResponse.json({ forms: pending }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to fetch pending forms:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
