import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { effectiveRoles } from "@/lib/admin-access";
import { isFeedbackManagerAny } from "@/lib/feedback-access";
import { FEEDBACK_CATEGORIES, FEEDBACK_SEVERITIES, FEEDBACK_STATUSES } from "@/lib/feedback-token";
import { FeedbackService } from "@/modules/feedback/feedback.service";

export const dynamic = "force-dynamic";

// GET /api/admin/feedback — triage queue. super_admin/admin ONLY (see
// src/lib/feedback-access.ts — deliberately narrower than most admin areas'
// full-admin set; registration/organizer can themselves be the subject of a
// complaint). Response never includes submitterRef — see
// FeedbackService.listForAdmin's column allowlist.
export async function GET(req: Request) {
  try {
    const session = await auth();
    const roles = effectiveRoles(session?.user?.role, session?.user?.roles);
    if (!session?.user || !isFeedbackManagerAny(roles)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const categoryParam = url.searchParams.get("category");
    const severityParam = url.searchParams.get("severity");

    const status = (FEEDBACK_STATUSES as readonly string[]).includes(statusParam || "")
      ? (statusParam as (typeof FEEDBACK_STATUSES)[number])
      : undefined;
    const category = (FEEDBACK_CATEGORIES as readonly string[]).includes(categoryParam || "")
      ? (categoryParam as (typeof FEEDBACK_CATEGORIES)[number])
      : undefined;
    const severity = (FEEDBACK_SEVERITIES as readonly string[]).includes(severityParam || "")
      ? (severityParam as (typeof FEEDBACK_SEVERITIES)[number])
      : undefined;

    const complaints = await FeedbackService.listForAdmin({ status, category, severity });
    return NextResponse.json({ complaints });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
