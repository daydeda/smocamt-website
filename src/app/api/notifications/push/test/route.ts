import { auth } from "@/auth";
import { PushService } from "@/modules/notifications/push.service";
import { NextResponse } from "next/server";
import { z } from "zod";
import { effectiveRoles } from "@/lib/access/admin-access";
import { rateLimit } from "@/lib/util/rate-limit";
import { isPushTestType, pushTestPayload } from "@/lib/push/push-test-samples";

const bodySchema = z.object({ type: z.string().refine(isPushTestType, "Unknown test type") });

// POST /api/notifications/push/test — admin diagnostic. Sends a SAMPLE notification
// to the CALLER's own subscribed devices only (never another user, never a broadcast)
// and returns a per-device result, so a missing VAPID key, a dead subscription or a
// push-service rejection is visible instead of silent. No DB writes except stamping
// last_success_at / removing a subscription the push service reports gone.
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const roles = effectiveRoles(session.user.role, session.user.roles);
    if (!roles.includes("admin") && !roles.includes("super_admin")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const limit = await rateLimit(`push-test:${session.user.id}`, 20, 10 * 60_000);
    if (!limit.success) {
      return NextResponse.json({ error: "Too many test notifications, try again in a few minutes" }, { status: 429 });
    }

    const { type } = bodySchema.parse(await req.json());
    const outcome = await PushService.sendTestToUser(session.user.id, pushTestPayload(type as never));

    if (!outcome.configured) {
      return NextResponse.json(
        { error: "Push is not configured on the server", missing: outcome.missing },
        { status: 503 },
      );
    }
    return NextResponse.json({ devices: outcome.results.length, results: outcome.results });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map((e) => e.message).join(", ") }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
