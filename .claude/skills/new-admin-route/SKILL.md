---
name: new-admin-route
description: Scaffold a new admin API route (src/app/api/admin/**/route.ts) pre-wired with ActiveCAMT's security pattern — server-side auth() role gate, Zod validation, and a db.transaction that writes an AuditService audit log. Use when adding any admin/staff API endpoint, so the role gate and audit log can't be forgotten. For routes that read medical data, audit logging is made mandatory.
---

# New Admin Route (ActiveCAMT)

Generates a new API route that already has the gate + audit pattern baked in, so the
"forgot the server-side check" / "forgot the audit log" class of bug can't happen.
The **server-side gate in the handler is the real source of truth** for data access —
proxy and UI gating are not enough (CLAUDE.md, Access control).

## The canonical pattern (mirror these)

Read and copy the shape of:
- `src/app/api/admin/announcement/route.ts` — `auth()` gate via a roles-array helper, Zod schema, `db.transaction` + `AuditService.logActionInternal(tx, …)`, `getClientIp(req)`, ZodError → 400.
- `src/app/api/admin/users/[id]/route.ts` — dynamic `{ params }`, super-admin escalation guards, audit `action` text that logs field *names*, not PII.

Standard skeleton:
```ts
import { auth } from "@/auth";
import { db } from "@/db";
import { /* tables */ } from "@/db/schema";
import { AuditService, getClientIp } from "@/modules/audit/audit.service";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ALLOWED = ["super_admin", "admin"] as const; // widen only if justified

const bodySchema = z.object({ /* … */ });

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user || !ALLOWED.includes(session.user.role as never)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const data = bodySchema.parse(await req.json());
    await db.transaction(async (tx) => {
      // …mutation…
      await AuditService.logActionInternal(tx, {
        actorId: session.user.id!,
        action: `…field names / role transitions, NOT PII…`,
        ipAddress: getClientIp(req),
      });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ") },
        { status: 400 }
      );
    }
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
```

## Workflow
1. Establish: route path + HTTP methods; which roles may call it (sensitivity); and **does it read or write medical detail / `medsCheckOption` / emergency contacts**?
2. Read the two canonical routes; generate `route.ts` mirroring them. Gate FIRST, before any DB access. Validate every input with Zod.
3. Pick `ALLOWED` by sensitivity: medical/PII → `super_admin`/`admin` only; broader staff data → add `registration`/`organizer` only if appropriate. Use the roles-array form when a user may hold multiple roles.
4. Wrap mutations + the audit write in ONE `db.transaction`.
5. Run `npm run lint && npm run build`.

## Mandatory PDPA rule
If the route **reads medical detail** (`chronicDiseases`, `medicalHistory`, `drugAllergies`, `foodAllergies`, `dietaryRestrictions`, `faintingHistory`, `emergencyContacts`, `emergencyMedication`, `attendance.medsCheckOption`): it MUST be admin-only AND MUST write an audit log on the read. No exceptions (CLAUDE.md, PDPA). The `action` text logs field names only — never the medical values themselves.

## Notes & follow-up
- If this is also a new admin **page/section** (not just an API), the 4 gating layers must move together — `src/proxy.ts`, the admin layout, the "Admin Panel" entry points, and `src/lib/access/admin-access.ts`. This skill scaffolds the API only; remind the user to update the others.
- Before shipping, run the `pdpa-access-guard` agent (its route + audit checklist covers this) and/or `/recheck`. Feature branch only.

## Output
The file created, the `ALLOWED` roles chosen and why, whether an audit log was included (and the trigger), lint/build results, and the cross-cutting reminders above.
