import { NextResponse } from "next/server";
import { z } from "zod";
import { PropertyTagsService } from "@/modules/property-tags/property-tags.service";
import { resolvePropertyTagStaff } from "@/lib/property-tag-access";
import { getClientIp } from "@/lib/rate-limit";
import { captureException } from "@/lib/logger";
import { normalizeTagCode } from "@/lib/property-tag";

export const dynamic = "force-dynamic";

// POST /api/admin/property-tags/assign
//   { action: "preview",  code, studentUserId }                  → who + soft warnings
//   { action: "confirm",  code, studentUserId, expectedOwnerId } → assign / reassign
//   { action: "unassign", code, expectedOwnerId }                → empty the sticker
// expectedOwnerId is the owner the staff member SAW (null = empty); a mismatch
// returns "changed" instead of overwriting a colleague's edit.

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), code: z.string(), studentUserId: z.string().min(1) }),
  z.object({
    action: z.literal("confirm"),
    code: z.string(),
    studentUserId: z.string().min(1),
    expectedOwnerId: z.string().min(1).nullable(),
  }),
  z.object({ action: z.literal("unassign"), code: z.string(), expectedOwnerId: z.string().min(1) }),
]);

export async function POST(req: Request) {
  try {
    const staff = await resolvePropertyTagStaff();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = schema.parse(await req.json());
    const code = normalizeTagCode(body.code);
    if (!code) return NextResponse.json({ status: "not_found" });
    const ip = getClientIp(req);

    if (body.action === "unassign") {
      const result = await PropertyTagsService.unassign({ code, expectedOwnerId: body.expectedOwnerId, actorId: staff.userId, ip });
      return NextResponse.json(result);
    }

    const result = await PropertyTagsService.assign({
      code,
      studentUserId: body.studentUserId,
      action: body.action,
      expectedOwnerId: body.action === "confirm" ? body.expectedOwnerId : null,
      actorId: staff.userId,
      ip,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    // A malformed JSON body is the caller's mistake, not a server failure —
    // answer 400 instead of logging it (which would also fire the error alert).
    if (e instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    captureException(e, { route: "POST /api/admin/property-tags/assign" });
    return NextResponse.json({ error: "Failed to update tag" }, { status: 500 });
  }
}
