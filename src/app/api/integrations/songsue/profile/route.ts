import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorizedSongsueSync } from "@/lib/integration-auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { verifyCrossAppQrToken } from "@/lib/qr-token";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AuditService } from "@/modules/audit/audit.service";

export const dynamic = "force-dynamic";

// Same actor-id convention as SongsueSyncService's SYNC_ACTOR_ID (no real
// staff session behind a service-to-service call) — audit_logs.actorId has
// no FK, see AuditService.
const SYNC_ACTOR_ID = "system:songsue-sync";

const SENSITIVE_FIELDS = [
  "chronicDiseases", "medicalHistory", "drugAllergies", "foodAllergies",
  "dietaryRestrictions", "faintingHistory", "emergencyMedication", "emergencyContacts",
] as const;

const querySchema = z.object({ token: z.string().min(1) });

// GET /api/integrations/songsue/profile?token=... — Songsue calls this when
// ITS OWN scanner scans an ActiveCAMT-issued cross-app QR (see qr-token.ts's
// signCrossAppQrToken) for a student it has no local account for yet. `token`
// is the cross-app companion token straight off that QR (NOT a bare email) —
// this route re-verifies it itself via verifyCrossAppQrToken (same shared
// ACTIVECAMT_SYNC_SECRET) to derive the email server-side. That ties every
// lookup to a genuine, still-valid (~5min + 30s grace) scan instead of letting
// any holder of the bearer secret harvest medical data for an arbitrary email
// — the secret alone authenticates the CALLER (Songsue's backend), not which
// student's record it may read.
// Lets Songsue auto-create a minimal account from this profile, the same PDPA
// tradeoff every other sync direction here already makes (identity + medical/
// emergency fields written; consent stays unset until the student uses
// Songsue itself — see ActiveCamtSyncService.upsertSyncedUser's doc comment
// on songsue's side).
// 404 if the token is invalid/expired, or ActiveCAMT doesn't know this email
// either (genuinely unknown to both apps) — same response either way so a
// caller can't use this to distinguish "bad token" from "unknown student".
export async function GET(req: Request) {
  if (!isAuthorizedSongsueSync(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(req);
  const limiter = await rateLimit(ip, 300, 60000);
  if (!limiter.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ token: url.searchParams.get("token") });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const email = verifyCrossAppQrToken(parsed.data.token);
  if (!email) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: {
      id: true, email: true, studentId: true, name: true, prefix: true, faculty: true, major: true,
      phone: true, nickname: true, image: true, religion: true, contactChannels: true,
      chronicDiseases: true, medicalHistory: true, drugAllergies: true, foodAllergies: true,
      dietaryRestrictions: true, faintingHistory: true, emergencyMedication: true, emergencyContacts: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // PDPA change-trail (field NAMES only, never values) for every read that
  // hands sensitive fields to the sibling app — mirrors the audit write on
  // the opposite (write) sync direction in SongsueSyncService.upsertSyncedUser.
  const exposedFields = SENSITIVE_FIELDS.filter((f) => {
    const v = user[f];
    return v != null && !(Array.isArray(v) && v.length === 0) && v !== "";
  });
  if (exposedFields.length > 0) {
    await AuditService.logAction({
      actorId: SYNC_ACTOR_ID,
      targetId: user.id,
      action: `Songsue profile fetch: returned medical/emergency info (${exposedFields.join(", ")})`,
      ipAddress: ip,
    });
  }

  return NextResponse.json({
    email: user.email, studentId: user.studentId, name: user.name, prefix: user.prefix,
    faculty: user.faculty, major: user.major, phone: user.phone, nickname: user.nickname,
    image: user.image, religion: user.religion, contactChannels: user.contactChannels,
    chronicDiseases: user.chronicDiseases, medicalHistory: user.medicalHistory,
    drugAllergies: user.drugAllergies, foodAllergies: user.foodAllergies,
    dietaryRestrictions: user.dietaryRestrictions, faintingHistory: user.faintingHistory,
    emergencyMedication: user.emergencyMedication, emergencyContacts: user.emergencyContacts,
  });
}
