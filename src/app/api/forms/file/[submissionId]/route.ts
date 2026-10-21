import { auth } from "@/auth";
import { downloadFormFile } from "@/lib/forms/form-file-storage";
import { FormsService } from "@/modules/forms/forms.service";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { NextResponse } from "next/server";
import { effectiveRoles, isGlobalRegistrationPosition } from "@/lib/access/admin-access";

export const dynamic = "force-dynamic";

// Mirrors ADMIN_ROLES in /api/admin/events/[id]/form — the same people who can
// see submissions in the admin events page may view their file answers.
const ADMIN_ROLES = ["super_admin", "admin", "registration", "organizer"];

// A stored key is always "<uuid>.<ext>"; anything else is a text/choice answer
// that happens to live at this question id, not a file — reject it.
const KEY_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]+$/i;

// A submission id is always a UUID; reject a malformed path before the DB query
// (a non-UUID can't match and would just waste a round-trip).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/forms/file/[submissionId]?q=<questionId> — stream a form file-answer.
// PDPA-gated: only the student who submitted it or an admin may view it. The file
// lives in a private bucket and is proxied here, so access is checked per request
// (never a public URL).
export async function GET(req: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { submissionId } = await params;
    if (!UUID_PATTERN.test(submissionId)) {
      return NextResponse.json({ error: "Invalid submission id" }, { status: 400 });
    }
    const questionId = new URL(req.url).searchParams.get("q");
    if (!questionId) {
      return NextResponse.json({ error: "Missing question id" }, { status: 400 });
    }

    const submission = await FormsService.getSubmissionById(submissionId);
    if (!submission) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const isOwner = submission.studentId === session.user.id;
    const isAdmin = ADMIN_ROLES.includes(session.user.role || "")
      || isGlobalRegistrationPosition(effectiveRoles(session.user.role, session.user.roles), session.user.smoPosition, session.user.anusmoPosition);
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const answers = (submission.answers as Record<string, unknown>) || {};
    const key = answers[questionId];
    if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { buffer, contentType } = await downloadFormFile(key);

    // PDPA: a third-party admin viewing a student's private form file leaves a trail
    // (the owner viewing their own file is not logged). Best-effort — never block the
    // view on an audit hiccup.
    if (isAdmin && !isOwner) {
      try {
        await AuditService.logAction({
          actorId: session.user.id!,
          targetId: submission.studentId ?? undefined,
          action: `Viewed private form file (submission ${submissionId}, question ${questionId})`,
          ipAddress: getClientIp(req),
        });
      } catch (e) {
        console.error("Failed to audit form-file view:", e);
      }
    }

    const ext = key.slice(key.lastIndexOf("."));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${submissionId}-${questionId}${ext}"`,
        // Never let a browser MIME-sniff a stored file into something executable.
        "X-Content-Type-Options": "nosniff",
        // Private: caches must revalidate auth, never store shared copies.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Form file view error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
