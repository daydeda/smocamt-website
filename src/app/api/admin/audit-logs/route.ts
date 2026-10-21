import { auth } from "@/auth";
import { AuditService } from "@/modules/audit/audit.service";
import { NextResponse, type NextRequest } from "next/server";

const PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || !["super_admin", "admin"].includes(session.user.role || "")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page")) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(params.get("pageSize")) || PAGE_SIZE));

    const { logs, total } = await AuditService.listLogsPage(page, pageSize);

    // targetId has no FK to users (schema.ts) — most rows are a real user's id
    // and resolve via the `target` relation above, but bulk-roster-read rows
    // (see src/lib/audit-target-list.ts) store a free-text "who was in the
    // response" list instead. When the relation doesn't resolve, fall back to
    // showing that raw text so the Target column isn't blank for those rows.
    const shaped = logs.map((log) => ({
      ...log,
      target: log.target ?? (log.targetId ? { id: log.targetId, name: log.targetId, studentId: undefined } : null),
    }));

    return NextResponse.json({ logs: shaped, total, page, pageSize });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

