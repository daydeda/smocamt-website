import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { FeedbackService } from "@/modules/feedback/feedback.service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ body: z.string().trim().min(1, "Message can't be empty.").max(5000) });

// POST /api/feedback/mine/[id]/messages — submitter posts a follow-up
// message on their OWN complaint (docs §10). Ownership-checked via
// submitterRef inside FeedbackService.postSubmitterMessage, never by id
// alone — the same guarantee PATCH /api/feedback/mine/[id] (close) already
// makes. Blocked once the complaint is 'closed'.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const data = bodySchema.parse(await req.json());

    const message = await FeedbackService.postSubmitterMessage(session.user.id, id, data.body);
    if (!message) {
      return NextResponse.json({ error: "Not found, not yours, or already closed." }, { status: 404 });
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
