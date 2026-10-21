import { NextResponse } from "next/server";
import { z } from "zod";
import { PropertyTagsService } from "@/modules/property-tags/property-tags.service";
import { resolvePropertyTagStaff, UUID_PATTERN } from "@/lib/property-tags/property-tag-access";
import { getClientIp } from "@/lib/util/rate-limit";
import { captureException } from "@/lib/util/logger";
import { MAX_TAGS_PER_BATCH, normalizeSeries } from "@/lib/property-tags/property-tag";

export const dynamic = "force-dynamic";

// POST /api/admin/property-tags/[id]/tags — mint N empty tags in a series.

const schema = z.object({
  series: z.string(),
  count: z.number().int().min(1).max(MAX_TAGS_PER_BATCH),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await resolvePropertyTagStaff();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = schema.parse(await req.json());
    const series = normalizeSeries(body.series);
    if (!series) return NextResponse.json({ error: "Invalid series" }, { status: 400 });
    const result = await PropertyTagsService.generateTags(id, series, body.count, staff.userId, getClientIp(req));
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    // A malformed JSON body is the caller's mistake, not a server failure —
    // answer 400 instead of logging it (which would also fire the error alert).
    if (e instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    captureException(e, { route: "POST /api/admin/property-tags/[id]/tags" });
    return NextResponse.json({ error: "Failed to generate tags" }, { status: 500 });
  }
}
