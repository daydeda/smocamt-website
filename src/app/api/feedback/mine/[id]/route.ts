import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { FeedbackService } from "@/modules/feedback/feedback.service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.literal("close") });

// PATCH /api/feedback/mine/[id] — submitter-initiated actions on their OWN
// complaint. Currently just 'close' (resolved -> closed, archiving it as
// history — see FeedbackService.closeMine's ownership + status-transition
// guards, enforced in the query itself, not just checked-then-trusted).
// Deliberately separate from PATCH /api/admin/feedback/[id] (staff-only,
// can do far more): this route can only ever touch a row whose submitterRef
// matches the CALLER's OWN session — never anyone else's, never by id alone.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    bodySchema.parse(await req.json());

    const updated = await FeedbackService.closeMine(session.user.id, id);
    if (!updated) {
      return NextResponse.json({ error: "Not found, not yours, or not yet resolved." }, { status: 404 });
    }
    return NextResponse.json({ complaint: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
