import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { FeedbackService, ACCOUNT_DAILY_SUBMISSION_LIMIT } from "@/modules/feedback/feedback.service";
import { FEEDBACK_CATEGORIES } from "@/lib/feedback-token";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/modules/audit/audit.service";
import { captureException } from "@/lib/logger";

// Severity is deliberately NOT accepted from the client — FeedbackService
// always derives it from CATEGORY_DEFAULT_SEVERITY server-side, so a
// harassment_safety report can never be under-flagged by a tampered request.
// message max is a generous technical backstop (matches MESSAGE_MAX in
// src/app/feedback/new/page.tsx), not a practical limit — high enough that
// no legitimate complaint should ever hit it, just a ceiling so a single
// submission can't blow up the notification email (feedback-notify.ts) or
// the admin list render.
// useAccountEmail: when contactOptIn is true, the submitter can choose to
// share their OWN ActiveCAMT account email (derived server-side from their
// session below, never client-supplied) instead of typing one in. Either
// way this is an explicit, active choice — contactOptIn defaults false, and
// picking "use my account email" is itself an opt-in action, not something
// inferred. See schema.ts's feedbackComplaints.contactInfo comment and docs
// §10 for why this is the ONLY way the submitter's real email ever reaches
// this table — never automatically, regardless of contactOptIn.
const submitSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  message: z.string().trim().min(10, "Please write at least 10 characters.").max(10000),
  contactOptIn: z.boolean().default(false),
  contactInfo: z.string().trim().max(200).optional(),
  useAccountEmail: z.boolean().default(false),
});

// POST /api/feedback — submit a new anonymous feedback/complaint. Requires a
// session (see docs/features/feedback-complaints.md §2: "logged in" today
// buys account-level rate limiting, not CMU-affiliation verification — the
// @cmu.ac.th Google OAuth restriction isn't live yet). Submitter identity is
// never stored raw; see FeedbackService.createComplaint / feedback-token.ts.
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // IP-level throttle first (cheap, catches unauthenticated abuse patterns
    // hitting this route repeatedly), then account-level below.
    const ip = getClientIp(req);
    const ipLimit = await rateLimit(ip, 20, 60_000);
    if (!ipLimit.success) {
      return NextResponse.json({ error: "Too many requests. Please wait a moment and try again." }, { status: 429 });
    }

    const body = submitSchema.parse(await req.json());

    const recentCount = await FeedbackService.accountSubmissionCountRecent(session.user.id);
    if (recentCount >= ACCOUNT_DAILY_SUBMISSION_LIMIT) {
      return NextResponse.json(
        { error: "You've reached today's submission limit. Please try again tomorrow." },
        { status: 429 },
      );
    }

    // "Use my account email" resolves to the CALLER's own session email —
    // never anything client-supplied — so this can't be used to attach an
    // arbitrary email to the row.
    const contactInfo = body.contactOptIn
      ? (body.useAccountEmail ? session.user.email ?? undefined : body.contactInfo)
      : undefined;

    const result = await FeedbackService.createComplaint({
      submitterId: session.user.id,
      category: body.category,
      message: body.message,
      contactOptIn: body.contactOptIn,
      contactInfo,
    });

    // Status/reply are checked via GET /api/feedback/mine (self-service,
    // matched against the submitter's own account) — no tracking code to
    // hand back here anymore, see docs/features/feedback-complaints.md §7.0.
    return NextResponse.json({ id: result.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map((e) => e.message).join(", ") }, { status: 400 });
    }
    captureException(error, { route: "POST /api/feedback" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
