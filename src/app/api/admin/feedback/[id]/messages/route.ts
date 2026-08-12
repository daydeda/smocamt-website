import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { effectiveRoles } from "@/lib/admin-access";
import { isFeedbackManagerAny } from "@/lib/feedback-access";
import { FeedbackService } from "@/modules/feedback/feedback.service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ body: z.string().trim().min(1, "Message can't be empty.").max(5000) });

// POST /api/admin/feedback/[id]/messages — staff posts a reply on ANY
// complaint (super_admin/admin only, src/lib/feedback-access.ts). Mutation +
// audit log are wrapped in one transaction inside
// FeedbackService.postStaffMessage, per this project's standard admin-route
// pattern. Also fires the submitter-facing email notification if they
// opted into a contact address that looks like an email (docs §10).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const roles = effectiveRoles(session?.user?.role, session?.user?.roles);
    if (!session?.user?.id || !isFeedbackManagerAny(roles)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const data = bodySchema.parse(await req.json());

    const message = await FeedbackService.postStaffMessage(id, session.user.id, data.body, req);
    if (!message) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ message });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map((e) => e.message).join(", ") }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
