import { NextResponse } from "next/server";
import { FeedbackService } from "@/modules/feedback/feedback.service";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/modules/audit/audit.service";
import { captureException } from "@/lib/logger";

// GET /api/feedback/track/[code] — public, deliberately no auth: the
// tracking code itself is the credential (see
// docs/features/feedback-complaints.md §5.1 — same reasoning as
// /api/calendar/feed/[token]). Public-by-design at the route level, so
// src/proxy.ts (which excludes ALL /api/* from its matcher) needs no change
// here — only the page at /feedback/track needed a proxy public-path entry.
//
// Rate-limited per IP specifically because a bare ~10-char tracking code is
// guessable at scale without this pairing — length alone is not the
// safeguard, the pairing with a tight limit is.
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const ip = getClientIp(req);
    const limit = await rateLimit(ip, 20, 60_000);
    if (!limit.success) {
      return NextResponse.json({ error: "Too many requests. Please wait a moment and try again." }, { status: 429 });
    }

    const { code } = await params;
    if (!code || code.trim().length < 6) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const complaint = await FeedbackService.getByTrackingCode(code);
    if (!complaint) {
      // Same 404 shape whether the code is malformed or simply doesn't match
      // any row — never distinguish "wrong code" from "no such complaint",
      // that distinction itself would leak information to a brute-force attempt.
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ complaint });
  } catch (error) {
    captureException(error, { route: "GET /api/feedback/track/[code]" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
