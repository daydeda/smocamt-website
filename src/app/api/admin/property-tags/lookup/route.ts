import { NextResponse } from "next/server";
import { PropertyTagsService } from "@/modules/property-tags/property-tags.service";
import { resolvePropertyTagStaff } from "@/lib/property-tags/property-tag-access";
import { captureException } from "@/lib/util/logger";
import { normalizeTagCode } from "@/lib/property-tags/property-tag";

export const dynamic = "force-dynamic";

// GET /api/admin/property-tags/lookup?code=<scanned text> — staff scanner
// lookup. Accepts the raw scanned URL or a hand-typed code.
export async function GET(req: Request) {
  try {
    const staff = await resolvePropertyTagStaff();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const code = normalizeTagCode(new URL(req.url).searchParams.get("code"));
    if (!code) return NextResponse.json({ status: "invalid" });
    const tag = await PropertyTagsService.getTagByCode(code);
    if (!tag) return NextResponse.json({ status: "not_found" });
    return NextResponse.json({ status: "found", tag });
  } catch (e) {
    captureException(e, { route: "GET /api/admin/property-tags/lookup" });
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}
