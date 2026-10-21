import { NextResponse } from "next/server";
import { z } from "zod";
import { PropertyTagsService } from "@/modules/property-tags/property-tags.service";
import { resolvePropertyTagStaff, UUID_PATTERN } from "@/lib/property-tags/property-tag-access";
import { getClientIp } from "@/lib/util/rate-limit";
import { captureException } from "@/lib/util/logger";
import { formatTagLabel } from "@/lib/property-tags/property-tag";

export const dynamic = "force-dynamic";

// GET   /api/admin/property-tags/[id] — the group and every tag in it, with owner.
// PATCH /api/admin/property-tags/[id] — rename / re-describe / archive.
// DELETE /api/admin/property-tags/[id] — only while no tag has an owner, because
//       stickers already on bags must keep resolving.

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullish(),
  status: z.enum(["open", "archived"]).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await resolvePropertyTagStaff();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const data = await PropertyTagsService.getGroup(id);
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      group: data.group,
      tags: data.tags.map((t) => ({ ...t, label: formatTagLabel(t.series, t.serial) })),
    });
  } catch (e) {
    captureException(e, { route: "GET /api/admin/property-tags/[id]" });
    return NextResponse.json({ error: "Failed to load group" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await resolvePropertyTagStaff();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = patchSchema.parse(await req.json());
    const patch: { name?: string; description?: string | null; status?: "open" | "archived" } = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description || null;
    if (body.status !== undefined) patch.status = body.status;
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    const row = await PropertyTagsService.updateGroup(id, patch, staff.userId, getClientIp(req));
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    // A malformed JSON body is the caller's mistake, not a server failure —
    // answer 400 instead of logging it (which would also fire the error alert).
    if (e instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    captureException(e, { route: "PATCH /api/admin/property-tags/[id]" });
    return NextResponse.json({ error: "Failed to update group" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await resolvePropertyTagStaff();
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const result = await PropertyTagsService.deleteGroup(id, staff.userId, getClientIp(req));
    if (result.status === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (result.status === "has_assigned") {
      return NextResponse.json({ error: "Group has assigned tags", assigned: result.assigned }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    captureException(e, { route: "DELETE /api/admin/property-tags/[id]" });
    return NextResponse.json({ error: "Failed to delete group" }, { status: 500 });
  }
}
