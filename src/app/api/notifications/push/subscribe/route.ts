import { auth } from "@/auth";
import { PushService } from "@/modules/notifications/push.service";
import { NextResponse } from "next/server";
import { z } from "zod";

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

// POST /api/notifications/push/subscribe — save (or transfer, if the endpoint
// was previously someone else's — see push.service.ts) a device's push
// subscription to the calling user.
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = subscribeSchema.parse(await req.json());
    const userAgent = req.headers.get("user-agent");

    await PushService.saveSubscription(session.user.id, data, userAgent);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ") },
        { status: 400 }
      );
    }
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
