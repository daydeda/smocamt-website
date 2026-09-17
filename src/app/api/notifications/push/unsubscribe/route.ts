import { auth } from "@/auth";
import { PushService } from "@/modules/notifications/push.service";
import { NextResponse } from "next/server";
import { z } from "zod";

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

// POST /api/notifications/push/unsubscribe — called from the sign-out button's
// click handler BEFORE next-auth's signOut() clears the session (see
// docs/features/push-notifications.md "Sign-out cleanup"), so a shared/lab
// device doesn't keep receiving a signed-out student's notifications. Scoped
// to the caller's own subscription — never lets one user delete another's.
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = unsubscribeSchema.parse(await req.json());
    await PushService.removeSubscriptionForUser(session.user.id, data.endpoint);

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
