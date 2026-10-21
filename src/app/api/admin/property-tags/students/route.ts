import { NextResponse } from "next/server";
import { PropertyTagsService } from "@/modules/property-tags/property-tags.service";
import { resolvePropertyTagStaff } from "@/lib/property-tag-access";
import { captureException } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET /api/admin/property-tags/students?q= — the assign picker. Matches name,
// nickname, รหัสนักศึกษา, phone or contact channel; returns only a masked phone.
export async function GET(req: Request) {
  try {
    const staff = await resolvePropertyTagStaff();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
    const students = await PropertyTagsService.searchStudents(q);
    return NextResponse.json({ students });
  } catch (e) {
    captureException(e, { route: "GET /api/admin/property-tags/students" });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
