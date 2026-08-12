import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { effectiveRoles } from "@/lib/admin-access";
import { isFeedbackManagerAny } from "@/lib/feedback-access";
import { FEEDBACK_SEVERITIES, FEEDBACK_STATUSES } from "@/lib/feedback-token";
import { FeedbackService } from "@/modules/feedback/feedback.service";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  // A severity change (downgrade in practice — harassment_safety starts
  // 'urgent') is deliberately admin-only and gets logged like any other
  // change here (docs/features/feedback-complaints.md §4).
  severity: z.enum(FEEDBACK_SEVERITIES).optional(),
  adminReply: z.string().trim().min(1).max(3000).optional(),
});

// PATCH /api/admin/feedback/[id] — update status/severity/reply. super_admin/
// admin ONLY (src/lib/feedback-access.ts). Mutation + audit log are wrapped
// in one transaction inside FeedbackService.updateComplaint, per this
// project's standard admin-route pattern.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const roles = effectiveRoles(session?.user?.role, session?.user?.roles);
    if (!session?.user?.id || !isFeedbackManagerAny(roles)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const data = updateSchema.parse(await req.json());
    if (!data.status && !data.severity && data.adminReply === undefined) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const updated = await FeedbackService.updateComplaint(id, data, session.user.id, req);
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ complaint: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ") },
        { status: 400 },
      );
    }
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
