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
// PDPA: only identity fields needed to seed a minimal Songsue account are
// sent (email/studentId/name/prefix/faculty/major/phone) — never medical,
// emergency-contact, or PDPA-consent data. ActiveCAMT's own PDPA consent is
// never inherited by the Songsue account created from this payload.
import { captureException } from "@/lib/logger";

export interface SongsueEventSyncPayload {
  externalId: string;
  title: string;
  description?: string | null;
  startTime: string;
  endTime: string;
  location?: string | null;
  pointsAwarded?: number | null;
  individualPointsAwarded?: number | null;
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
