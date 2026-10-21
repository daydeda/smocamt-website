import { NextResponse } from "next/server";
import { z } from "zod";
import { PropertyTagsService } from "@/modules/property-tags/property-tags.service";
import { resolvePropertyTagStaff } from "@/lib/property-tag-access";
import { captureException } from "@/lib/logger";

export const dynamic = "force-dynamic";

// POST /api/admin/property-tags/resolve-student { token }
// Turns a scanned Digital ID QR into the student to assign a tag to. Only the
// signed short-lived token is accepted; "invalid" covers expired and forged.

const schema = z.object({ token: z.string().min(1).max(600) });

export async function POST(req: Request) {
  try {
    const staff = await resolvePropertyTagStaff();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { token } = schema.parse(await req.json());
    const student = await PropertyTagsService.resolveStudentByDigitalId(token);
    if (!student) return NextResponse.json({ status: "invalid" });
    return NextResponse.json({ status: "found", student });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    if (e instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    captureException(e, { route: "POST /api/admin/property-tags/resolve-student" });
    return NextResponse.json({ error: "Failed to resolve student" }, { status: 500 });
  }
}
