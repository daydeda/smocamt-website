# Evidence check-in

**Status:** two designs shipped 2026-09 for เก็บก้าว (a multi-day step
challenge), covering two different real-world shapes of "prove you did the
activity." Only one is actually used by เก็บก้าว — see below.

| | `checkInMode: 'evidence'` | `requireCheckOut` |
|---|---|---|
| Who verifies | Nobody (auto-award) | Staff, in person |
| Physical checkpoint | None — fully remote | Two: arrival + departure |
| Photo's role | *Is* the proof, gates points | Kept as a record only — staff already decided |
| Used by เก็บก้าว today? | **No — dormant** | **Yes** |

Kept both because they solve genuinely different problems: `evidence` mode is
for an event with **no staff presence at all**; `requireCheckOut` is for one
where **staff are there but the "activity" itself happens off-site** between
two scans (เก็บก้าว's actual shape — see "Check-in / check-out" below).

## Design: self-service (`checkInMode: 'evidence'`) — dormant

### Problem

Some events have no physical location to scan a QR code, and no staff
presence either — e.g. a purely remote activity where "attendance" means the
student did something off-site and can only prove it with a screenshot, with
nobody available to look at it in person. The existing check-in model
(`ScannerService`, QR/manual/walk-in) assumes a scan point; it has nothing for
"the student self-reports and we trust-but-verify."

This turned out to be the **wrong shape for เก็บก้าว** — staff ARE present
(both to start and end the day), so a genuinely staff-supervised flow
(`requireCheckOut`, below) fit better. Left in place, dormant, for a future
event that's truly unstaffed/remote.

### Design

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

## Design: check-in / check-out (`requireCheckOut`) — what เก็บก้าว actually uses

### Problem

เก็บก้าว's real flow, as clarified mid-build: a student scans in with staff at
the start (normal QR check-in via ActiveCAMT), goes and does the day's walk
off-site, then comes back and checks in with staff **again**. At that second
touchpoint they show their Strava; staff looks at it right there and decides
real-vs-fake before the student gets that day's points. If a fake one slips
through and is caught later, staff deducts points using the existing manual
award/deduct tool (`ScannerService` `action: "score"`) — no new work needed
for that part.

That's fundamentally different from the self-service design above: staff are
present and make the real/fake call **in person**, before points are ever
awarded — the photo just needs to be *kept* afterward as a record, not
reviewed remotely.

### Design

No new status value, no parallel service, minimal surface on
`ScannerService.processScan` — just a `checkOutTime` signal layered onto the
exact same `attendance` row and flow every other event already uses:

- `events.requireCheckOut` (boolean, default false): opts an event into the
  two-step flow. Every existing event is unaffected (`false`).
- **Check-in (first scan+confirm)**: identical to today's flow in every way
  — quota, walk-ins, medical alert, Songsue sync, pre-test warning, staff
  auto-assign, `status: 'attended'`, `checkInTime` — **except** the
  individual-points award is skipped when `requireCheckOut` is true (wrapped
  with `if (!event.requireCheckOut)` at all three award call sites in
  `processScan`). A student is now "arrived, not yet checked out":
  `status: 'attended'` but `checkOutTime` still null.
- **Returning scan**: the existing `if (record.status === "attended")` branch
  now checks `event.requireCheckOut && !record.checkOutTime` first — if true,
  this is a check-out attempt, not a duplicate, and the API returns a new
  `pending_checkout` status instead of `already_checked_in`.
- **Check-out (`action: "confirm_checkout"`, new)**: `ScannerService
  .confirmCheckout` — staff has already looked at the evidence and decided;
  this call requires an `evidenceFileKey` (uploaded via the existing
  `/api/forms/upload`), sets `checkOutTime` + `evidenceFileKey`, and *only
  then* awards that day's `individualPointsAwarded` — the exact same
  `awardIndividualPoints` primitive the normal flow uses, so house points,
  the export, everything downstream is identical to a normal check-in, just
  timed later. An `isNull(checkOutTime)` guard on the update closes the race
  where two staff try to confirm the same check-out at once.
- **`events.checkOutEvidenceRequired`** (boolean, default `true` — sub-option
  of `requireCheckOut`, meaningless unless that's also on): some activities
  have no separate evidence to look at (e.g. staff directly witness the whole
  thing) — trusting the in-person re-scan alone, with no photo, is the whole
  point of setting this to `false`. `ScannerService.confirmCheckout` only
  enforces the "a proof photo is required" error when this is `true`; a
  malformed `evidenceFileKey` is still always rejected if one is sent,
  regardless of the requirement. The audit log line distinguishes the two
  cases ("with evidence" vs. "staff-witnessed, no evidence required").
- Scanner UI (`src/app/admin/scanner/page.tsx`): a `pending_checkout` result
  shows a photo-attach control + "Confirm Check-out" button (disabled until a
  photo is attached), parallel to the existing "Confirm Physical Presence"
  button for `pending_confirmation`. The first-scan confirm button also
  relabels to "Confirm Check-in (no points yet)" for a `requireCheckOut`
  event, so staff aren't confused about when points actually land.
- The kept photo reuses `attendance.evidenceFileKey` (the same column the
  dormant self-service design uses) and the same
  `/api/attendance/evidence/[attendanceId]` serving route — no new storage
  path.

### Admin setup

Event editor (`/admin/events`) → check-in method stays "QR / staff scanner" →
tick **"Require check-out (2 scans: arrival + evidence-reviewed departure)"**.
That's the whole setup; no per-session config needed (unlike the dormant
design's per-day code word) since the review happens in person, not against a
published word. A nested checkbox, **"Require a proof photo for check-out"**
(default on), appears once that's ticked — turn it off for an event where
staff witness the whole thing directly and a kept photo adds nothing; the
second scan then confirms check-out on its own, no upload needed.

## Files

**Self-service (`checkInMode: 'evidence'`) — dormant:**

- Schema: `src/db/schema.ts` (`events.checkInMode`,
  `eventSessions.evidenceNonce`/`evidencePrompt`) — migration
  `drizzle/0039_brief_paibok.sql`.
- Pure logic + tests: `src/lib/evidence-checkin.ts` /
  `evidence-checkin.test.ts` (nonce matching, window status).
- Orchestration: `src/modules/events/evidence-checkin.service.ts` — mirrors
  the walk-in path in `scanner.service.ts` (same attendance-row shape, same
  `awardIndividualPoints` call).
- Student API: `src/app/api/events/[id]/evidence-checkin/route.ts` (GET the
  event's sessions + my submission status, POST a submission).
- Admin config UI: `src/app/admin/events/page.tsx` (check-in mode toggle +
  per-session code word/prompt, in the event editor).
- Student UI: `src/app/dashboard/events/[id]/evidence/page.tsx`, linked from
  the event preview modal in `DashboardClient.tsx` (replaces the Register
  button for a `checkInMode: 'evidence'` event — there's no registration step
  at all for this mode).

**Check-in/out (`requireCheckOut`) — what เก็บก้าว uses:**

- Schema: `src/db/schema.ts` (`events.requireCheckOut`,
  `attendance.checkOutTime`, reusing `attendance.evidenceFileKey`) — migration
  `drizzle/0040_skinny_dark_phoenix.sql`. `events.checkOutEvidenceRequired`
  (default `true`) added later in `drizzle/0043_peaceful_gambit.sql`.
- Orchestration: `src/modules/events/scanner.service.ts` — the narrow
  `requireCheckOut` branches inside `processScan` (award-call sites + the
  `record.status === "attended"` check) plus the new `confirmCheckout`
  private method.
- API: `src/app/api/admin/scan/route.ts` — new `confirm_checkout` action +
  `evidenceFileKey` param, both passed straight through to `processScan`.
- Admin config UI: `src/app/admin/events/page.tsx` — "Require check-out"
  checkbox (only shown for `checkInMode: 'qr'`); `requireCheckOut` wired
  through `src/app/api/admin/events/route.ts` + `[id]/route.ts`, deliberately
  **not** in `PRESIDENT_EDITABLE_FIELDS` (staff-only).
- Staff UI: `src/app/admin/scanner/page.tsx` — new `pending_checkout` result
  state, photo-attach control, "Confirm Check-out" button, and a relabeled
  first-confirm button for `requireCheckOut` events.

**Shared by both:**

- File serving: `src/app/api/attendance/evidence/[attendanceId]/route.ts` —
  streams `attendance.evidenceFileKey` regardless of which flow set it.

## Known gaps / deliberately deferred

Self-service (`checkInMode: 'evidence'`) — dormant, so these matter only if it's ever turned on:
- No reviewer/approval UI — auto-award only.
- No file-hash duplicate detection (a student could reuse someone else's
  screenshot with the correct nonce; the nonce blocks pre-uploading, not
  sharing).

Both flows:
- Evidence file serving isn't president-scoped yet (staff-only, matches
  เก็บก้าว being centrally run).
- No "X/6 days completed" rollup — an organizer currently cross-references
  the per-day attendance exports manually.
- No claw-back automation if a fake submission is caught after points were
  already awarded — use the existing manual score-deduct tool (unchanged,
  not part of this feature).
