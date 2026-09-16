# Evidence check-in

**Status:** shipped 2026-09 (built for เก็บก้าว, a multi-day step challenge). Reusable — any future event can opt in.

## Problem

Some events have no physical location to scan a QR code at all — e.g. a
multi-day step/walking challenge (เก็บก้าว) where "attendance" means the
student did something off-site (walked, ran) and can only prove it with a
screenshot (Strava, a fitness app). The existing check-in model
(`ScannerService`, QR/manual/walk-in) assumes a scan point; it has nothing for
"the student self-reports and we trust-but-verify."

## Design

Rather than build a parallel system, evidence check-in is a **second way to
fill the exact same `attendance` row** the scanner already writes — same
`(sessionId, studentId)` uniqueness, same `status: 'attended'`, same
`awardIndividualPoints` call, same `checkInTime`. Everything downstream
(house points at event-end, the attendance roster + xlsx export, no-show
strikes, the multi-day points policy) keeps working unmodified because it
only ever looked at the `attendance` table, never at *how* a row got there.

- `events.checkInMode`: `'qr'` (default, unchanged behavior) | `'evidence'`.
- `eventSessions.evidenceNonce`: the day's code word, set by the organizer and
  published out-of-band (Discord/announcement) at some point during that
  session's window. Never sent to the client in the GET response — checked
  server-side only.
- `eventSessions.evidencePrompt`: optional per-day instructions shown above
  the submission form (e.g. "attach today's Strava distance screenshot").
- `attendance.evidenceFileKey` / `evidenceNonceSubmitted`: what the student
  actually submitted, stored on the same attendance row.

### Anti-backdating, not a security secret

The nonce is a lightweight deterrent, not a credential: a short word posted
publicly once a day. Its job is to make "submit all 6 days at once on day 6"
impossible (a student can't know a future day's word), not to resist a
determined attacker. Combined with the window check
(`src/lib/evidence-checkin.ts`: `getEvidenceWindowStatus`, open from a
session's `startTime` through `endTime` + a 12h grace period), a submission is
tied to roughly the right day without needing image forensics or a review
queue.

### Auto-award, not staff-reviewed

Submitting valid evidence immediately flips the attendance row to `attended`
and awards that session's `individualPointsAwarded` — no approval queue. This
was a deliberate scope call (see the `/loop`-adjacent conversation that shipped
this): staff can spot-check via the attendance export
(`/admin/events` → event → Attendance) same as any other check-in method, and
revoke a registration via the existing `DELETE /api/admin/events/[id]/
attendance` route if a submission turns out to be fraudulent (note: that route
does **not** claw back already-awarded points — same pre-existing gap as
every other check-in method, not something this feature introduces).

### PDPA

Evidence photos land in the same private `form-uploads` bucket as form file
answers (`src/lib/form-file-storage.ts`, reused as-is) and are served only
through the auth-guarded `/api/attendance/evidence/[attendanceId]` route
(owner or staff, never a public URL) — same shape as
`/api/forms/file/[submissionId]`. A staff view of someone else's evidence
photo is audit-logged; the owner viewing their own is not. A route.tsx
comment flags that this does **not** yet extend to scoped club/major
presidents the way the medical-detail exception does — add
`EventScopeService` scoping there if a president-run evidence event needs it.

Operational note for organizers: warn students not to submit a screenshot
that reveals a live route map (home location) — ask for the activity-summary
screen instead. Evidence photos should follow the same retention/deletion
plan as other event media once the campaign ends (see `/retention-sweep`).

## Files

- Schema: `src/db/schema.ts` (`events.checkInMode`,
  `eventSessions.evidenceNonce`/`evidencePrompt`,
  `attendance.evidenceFileKey`/`evidenceNonceSubmitted`) — migration
  `drizzle/0039_brief_paibok.sql`.
- Pure logic + tests: `src/lib/evidence-checkin.ts` /
  `evidence-checkin.test.ts` (nonce matching, window status).
- Orchestration: `src/modules/events/evidence-checkin.service.ts` — mirrors
  the walk-in path in `scanner.service.ts` (same attendance-row shape, same
  `awardIndividualPoints` call).
- Student API: `src/app/api/events/[id]/evidence-checkin/route.ts` (GET the
  event's sessions + my submission status, POST a submission).
- File serving: `src/app/api/attendance/evidence/[attendanceId]/route.ts`.
- Admin config UI: `src/app/admin/events/page.tsx` (check-in mode toggle +
  per-session code word/prompt, in the event editor).
- Admin API wiring: `src/app/api/admin/events/route.ts` + `[id]/route.ts`,
  shared session shape in `src/lib/event-schema.ts`. `checkInMode` is
  deliberately **not** in `PRESIDENT_EDITABLE_FIELDS` — staff-only, like
  `staffUserIds`/`songsueLinked`.
- Student UI: `src/app/dashboard/events/[id]/evidence/page.tsx`, linked from
  the event preview modal in `DashboardClient.tsx` (replaces the Register
  button for a `checkInMode: 'evidence'` event — there's no registration step
  at all for this mode).

## Known gaps / deliberately deferred

- No reviewer/approval UI — auto-award only (see above).
- No file-hash duplicate detection (a student could reuse someone else's
  screenshot with the correct nonce; the nonce blocks pre-uploading, not
  sharing).
- Evidence file serving isn't president-scoped yet.
- No "X/6 days completed" rollup — an organizer currently cross-references
  the per-day attendance exports manually.
