import { NextResponse } from "next/server";
import { z } from "zod";
import { PropertyTagsService } from "@/modules/property-tags/property-tags.service";
import { resolvePropertyTagStaff } from "@/lib/property-tag-access";
import { getClientIp } from "@/lib/rate-limit";
import { captureException } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET  /api/admin/property-tags — tag groups with total/assigned counts, plus
//      every series in use (so the generate form can show "next: SMO-051").
// POST /api/admin/property-tags — create a group ("Bag for Trekking").

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
});

export async function GET() {
  try {
    const staff = await resolvePropertyTagStaff();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const [groups, series] = await Promise.all([PropertyTagsService.listGroups(), PropertyTagsService.listSeries()]);
    return NextResponse.json({ groups, series });
  } catch (e) {
    captureException(e, { route: "GET /api/admin/property-tags" });
    return NextResponse.json({ error: "Failed to load property tag groups" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const staff = await resolvePropertyTagStaff();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = createSchema.parse(await req.json());
    const row = await PropertyTagsService.createGroup(
      { name: body.name, description: body.description || null },
      staff.userId,
      getClientIp(req),
    );
    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    // A malformed JSON body is the caller's mistake, not a server failure —
    // answer 400 instead of logging it (which would also fire the error alert).
    if (e instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    captureException(e, { route: "POST /api/admin/property-tags" });
    return NextResponse.json({ error: "Failed to create group" }, { status: 500 });
  }
}
