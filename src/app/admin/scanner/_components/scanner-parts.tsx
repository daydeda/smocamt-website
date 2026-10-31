"use client";

import type { MedicalFlags } from "@/lib/pdpa/medical-signal";
import { House } from "lucide-react";
import { bangkokDateKey } from "@/lib/events/event-schema";
import dynamic from "next/dynamic";

// Pre-test warning QR — client-only (qrcode.react reads the DOM). Canvas, not
// SVG: Android/Chrome "force dark" auto-inverts inline <svg> DOM content, but
// leaves <canvas> alone like a raster image, so it stays scannable on a
// staff device with dark mode forced on. Same component the dashboard uses
// to render the student attendance QR.
export const QRCodeCanvas = dynamic(() => import("qrcode.react").then((mod) => mod.QRCodeCanvas), {
  ssr: false,
});

export type ScanStatus = "success" | "success_walk_in" | "success_checkout" | "pending_confirmation" | "pending_checkout" | "already_checked_in" | "already_checked_out" | "walk_ins_disabled" | "not_found" | "quota_full" | "found" | "not_registered" | "error";

// "prize" is not a scan mode of THIS camera: it swaps the page body for
// ScannerPrizeTab, whose PrizeAwardPanel runs its own camera (see selectMode).
export type ScanMode = "checkin" | "score" | "prize" | "shop" | "property" | "lookup";
// Tabs that run their own camera (a dialog with its own html5-qrcode), so this
// page's scanner must be stopped while they're open.
export const ownsCamera = (m: ScanMode) => m === "prize" || m === "shop" || m === "property" || m === "lookup";

export type ScanResult = {
  status: ScanStatus;
  student?: { 
    name: string; 
    nickname: string; 
    studentId?: string; 
    house?: string; 
    houseId?: string;
    houseColor?: string;
    hasMedicalCondition?: boolean;
    // PDPA signal-only breakdown — sent to every scanning role, unlike the
    // raw string fields below which are admin/super_admin-only.
    medicalFlags?: MedicalFlags;
    chronicDiseases?: string | null;
    medicalHistory?: string | null;
    drugAllergies?: string | null;
    foodAllergies?: string | null;
    dietaryRestrictions?: string | null;
    faintingHistory?: boolean;
    emergencyMedication?: string | null;
    points?: number;
  };
  isWalkIn?: boolean;
  checkedInAt?: string;
  error?: string;
  rawToken?: string;
  // Set by the scan API on a confirmed check-in when the event has a pre-test (K_pre)
  // this attendee hasn't completed — drives the warning + QR shown below the result.
  preTestWarning?: { formId: string; title: string } | null;
};

export type EventSession = {
  id: string;
  title: string | null;
  startTime: string;
  endTime: string;
  sortOrder: number;
};
export type Event = { id: string; title: string; startTime: string; endTime: string; sessions?: EventSession[]; songsueLinked?: boolean; requireCheckOut?: boolean; checkOutEvidenceRequired?: boolean };

// Sessions sorted into display order ("Day 1", "Day 2", …).
export function sortedSessions(sessions?: EventSession[]): EventSession[] {
  return [...(sessions ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder || new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

// Mirrors the server's resolveCurrentSessionId: the session whose window contains
// now → the nearest upcoming → the most recent past. Keeps the default day in sync
// with what the server would pick when sessionId is omitted.
export function pickCurrentSessionId(sessions?: EventSession[]): string {
  const sorted = sortedSessions(sessions);
  if (sorted.length === 0) return "";
  const now = Date.now();
  const current = sorted.find(
    (s) => new Date(s.startTime).getTime() <= now && now <= new Date(s.endTime).getTime()
  );
  if (current) return current.id;
  const upcoming = sorted.find((s) => new Date(s.startTime).getTime() > now);
  if (upcoming) return upcoming.id;
  return sorted[sorted.length - 1].id;
}

// Mirrors the "live" check used on the admin events page (src/app/admin/events/page.tsx):
// now falls within the event's own start/end window.
export function isEventLive(e: Pick<Event, "startTime" | "endTime">): boolean {
  const now = Date.now();
  return now >= new Date(e.startTime).getTime() && now <= new Date(e.endTime).getTime();
}

// Not started yet, but starts later TODAY (Asia/Bangkok) — the only case the
// go-live route (POST /api/admin/events/[id]/go-live) accepts.
export function startsLaterToday(e: Pick<Event, "startTime">): boolean {
  const now = new Date();
  return now.getTime() < new Date(e.startTime).getTime() && bangkokDateKey(e.startTime) === bangkokDateKey(now.toISOString());
}

// Events sorted for the scanner's picker: whichever event is live right now floats
// to the top (ties broken by the server's own desc-startTime order) so the staff
// sees the correct event first instead of having to hunt for it in the dropdown.
export function sortedForScanner(events: Event[]): Event[] {
  return [...events].sort((a, b) => Number(isEventLive(b)) - Number(isEventLive(a)));
}

// Small pulsing "LIVE" pill — reused on the event selector, its dropdown list, and
// the camera overlay so a live event is unmistakable everywhere its name appears.
export function LiveBadge({ label, small }: { label: string; small?: boolean }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: small ? "2px 6px" : "3px 8px",
      borderRadius: 999,
      background: "rgb(var(--emerald-500-rgb) / 0.15)",
      color: "var(--emerald-500)",
      fontSize: small ? 10 : 11,
      fontWeight: 800,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      flexShrink: 0,
      whiteSpace: "nowrap",
    }}>
      <span className="animate-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--emerald-500)" }} />
      {label}
    </span>
  );
}

// Post-check-in notice for a songsueLinked event's confirmed attendance. This
// modal renders on the STAFF's own scanning device, not the student's — it
// must never navigate that device away to Songsue (that used to happen here
// via an auto-redirect and would kick the operator out of the scanner between
// every single student). It's purely informational: tell the admin the
// student checked in via ActiveCAMT and to ask them to open Songsue
// themselves to see their house color.
export function SongsueCheckinNotice({ message }: { message: string }) {
  return (
    <div
      style={{
        marginTop: 16,
        padding: 16,
        borderRadius: 16,
        background: "rgb(var(--indigo-500-rgb) / 0.06)",
        border: "1.5px dashed rgb(var(--indigo-500-rgb) / 0.4)",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        textAlign: "left",
      }}
    >
      <House size={18} color="var(--indigo-500)" style={{ marginTop: 1, flexShrink: 0 }} />
      <p style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600 }}>
        {message}
      </p>
    </div>
  );
}

// A student's QR token is stable for a 5-minute window (WINDOW_MS, see
// src/lib/qr-token.ts). Clearing the "last decoded" guard unconditionally on
// modal close lets the SAME still-in-frame student re-decode within
// milliseconds of dismissing a result — the server then truthfully answers
// already_checked_in and a ghost result modal reopens with nobody having
// scanned anything. This cooldown map remembers recently-decoded tokens for a
// short grace period so a stray re-decode of the same code is silently
// dropped before it ever reaches the server. lastTokenRef itself is still
// cleared in closeModal (see there) — it only dedupes the camera firing many
// times a second on ONE in-flight decode, and clearing it is what lets a
// genuine retry of the same code work right away after a transient error.
export const SCANNER_COOLDOWN_MS = 20_000;

export function pruneAndCheckScannerCooldown(map: Map<string, number>, key: string): boolean {
  const now = Date.now();
  for (const [k, ts] of map) {
    if (now - ts > SCANNER_COOLDOWN_MS) map.delete(k);
  }
  const ts = map.get(key);
  return ts !== undefined && now - ts < SCANNER_COOLDOWN_MS;
}

export function markScannerCooldown(map: Map<string, number>, key: string) {
  map.set(key, Date.now());
}

// Only these statuses are a definitively SETTLED, stable per-student outcome
// worth cooling down. Deliberately excludes pending_confirmation/
// pending_checkout (still awaiting a follow-up action on this same token, not
// a re-decode) and not_found/error/quota_full/walk_ins_disabled/not_registered
// (may be transient or a genuine mis-scan staff wants to retry immediately).
export const SCANNER_SETTLED_STATUSES: ScanStatus[] = ["success", "success_walk_in", "success_checkout", "already_checked_in", "already_checked_out"];
