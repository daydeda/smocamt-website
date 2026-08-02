// Best-effort, one-directional sync from ActiveCAMT into the sibling app
// Songsue: when a staff member flags an event `songsueLinked`, its metadata
// and each student's registration/attendance status are mirrored into
// Songsue's own `events`/`users`/`attendance` tables via two service-to-service
// routes, so Songsue's independent house-points system can credit the right
// house — see src/app/api/admin/events/route.ts, .../register/route.ts, and
// src/modules/events/scanner.service.ts for the call sites.
//
// NEVER throws — every failure is logged (captureException) and swallowed, so
// a Songsue outage can never block an ActiveCAMT admin save, registration, or
// check-in. There is no retry queue in this v1; a failed sync is only visible
// via the error log/webhook.
//
// PDPA: identity fields (email/studentId/name/prefix/faculty/major/phone/
// nickname/image/religion/contactChannels) AND medical/emergency-contact data
// are both sent (product decision — see songsue's activecamt-sync.service.ts
// upsertSyncedUser/backfillIncompleteProfile doc comments for the exact
// tradeoff and how Songsue gates each write: full identity+medical write on
// brand-new account creation; on an EXISTING Songsue row, only fields that
// are still blank there get filled in — a completed profile is never
// touched). ActiveCAMT's own PDPA consent is never inherited as Songsue's
// own consent — pdpaConsent always starts/stays false until the student
// explicitly consents inside Songsue itself.
import { captureException } from "@/lib/logger";

// A staff member assigned to a songsueLinked event (events.staffUserIds), resolved
// to email/name before sending — ActiveCAMT's own user ids mean nothing on
// Songsue's side, so the caller must look these up first (see the three
// syncEventToSongsue call sites). Songsue upserts a matching account by email,
// same identity join every other sync direction here already uses.
export interface SongsueEventStaffMember {
  email: string;
  name: string;
}

export interface SongsueEventSyncPayload {
  externalId: string;
  title: string;
  description?: string | null;
  startTime: string;
  endTime: string;
  location?: string | null;
  pointsAwarded?: number | null;
  individualPointsAwarded?: number | null;
  // Needed so a check-in via Songsue's OWN scanner (bidirectional check-in sync,
  // scanner.service.ts) can walk in a student the same way ActiveCAMT's own
  // scanner would — without these, the mirrored event defaults to Songsue's
  // schema defaults (walkInsEnabled=false, quota=unlimited), making walk-ins
  // structurally impossible there regardless of the event's real settings here.
  walkInsEnabled?: boolean | null;
  quota?: number | null;
  quotaWalkIn?: number | null;
  // Banner — mirrors events.imageUrl/imageUrls (see schema.ts: imageUrl always
  // mirrors imageUrls[0]). Always sent as the event's CURRENT full value (not a
  // partial patch), same convention as every other field here.
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  // Full CURRENT roster, not a delta — Songsue replaces its mirrored
  // staffUserIds wholesale with whatever this list resolves to, so removing
  // someone here removes them there too.
  staff?: SongsueEventStaffMember[];
}

export interface SongsueEmergencyContact {
  name: string;
  relationship: string;
  phone: string;
}

export interface SongsueRegistrationSyncPayload {
  externalEventId: string;
  user: {
    email: string;
    studentId?: string | null;
    name: string;
    prefix?: string | null;
    faculty?: string | null;
    major?: string | null;
    phone?: string | null;
    nickname?: string | null;
    image?: string | null;
    religion?: string | null;
    contactChannels?: string | null;
    chronicDiseases?: string | null;
    medicalHistory?: string | null;
    drugAllergies?: string | null;
    foodAllergies?: string | null;
    dietaryRestrictions?: string | null;
    faintingHistory?: boolean | null;
    emergencyMedication?: string | null;
    emergencyContacts?: SongsueEmergencyContact[] | null;
  };
  status: "registered" | "attended" | "cancelled";
}

function songsueSyncConfig(): { baseUrl: string; secret: string } | null {
  const baseUrl = process.env.SONGSUE_SYNC_URL;
  const secret = process.env.ACTIVECAMT_SYNC_SECRET;
  if (!baseUrl || !secret) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), secret };
}

async function postSync(path: string, body: unknown): Promise<void> {
  const config = songsueSyncConfig();
  if (!config) {
    // Not configured (e.g. local dev without a Songsue instance) — silently
    // skip rather than spamming the error log on every save.
    return;
  }

  try {
    const res = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.secret}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      captureException(new Error(`Songsue sync failed: ${path} -> ${res.status} ${text}`), {
        songsueSyncPath: path,
      });
    }
  } catch (error) {
    captureException(error, { songsueSyncPath: path });
  }
}

// Called on ActiveCAMT event create/update when `songsueLinked` is (or was
// just set) true — see api/admin/events/route.ts and .../[id]/route.ts.
export async function syncEventToSongsue(payload: SongsueEventSyncPayload): Promise<void> {
  await postSync("/api/integrations/activecamt/events", payload);
}

// Called after registration (POST/DELETE api/events/[id]/register) and at
// each QR check-in confirm (scanner.service.ts) for a `songsueLinked` event.
export async function syncRegistrationToSongsue(payload: SongsueRegistrationSyncPayload): Promise<void> {
  await postSync("/api/integrations/activecamt/register", payload);
}

// Called by UsersService.resolveStudentByToken when ActiveCAMT's OWN scanner
// resolves a cross-app QR (a student who generated their QR on Songsue but is
// being scanned here on ActiveCAMT — see qr-token.ts's verifyCrossAppQrToken)
// to an email with no local ActiveCAMT account yet. Pulls that student's
// profile from Songsue so ActiveCAMT can auto-create a minimal account and
// complete the check-in — see SongsueSyncService.upsertSyncedUser for the
// write side and its PDPA doc comment. Returns null (never throws) if Songsue
// is unreachable, doesn't know this email either, or sync isn't configured —
// the caller falls through to "not found" rather than the scan erroring out.
export async function fetchSongsueProfileByEmail(
  email: string
): Promise<SongsueRegistrationSyncPayload["user"] | null> {
  const config = songsueSyncConfig();
  if (!config) return null;

  try {
    const res = await fetch(
      `${config.baseUrl}/api/integrations/activecamt/profile?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${config.secret}` } }
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      captureException(new Error(`Songsue profile fetch failed: ${res.status} ${text}`), {
        songsueProfileFetch: true,
      });
      return null;
    }
    return await res.json();
  } catch (error) {
    captureException(error, { songsueProfileFetch: true });
    return null;
  }
}
