# Feature Spec — Multi-Day / Multi-Session Check-in (Implementation Design)

> **STATUS: IMPLEMENTED for `'once'` mode (shipped on `feat/multi-day-checkin`).**
> `'per_session'` mode is **deferred and hidden in the UI** — see §10. Companion of the
> policy docs: [`multi-day-points-policy.md`](./multi-day-points-policy.md) (points +
> Strike-out) and [`multi-day-partial-attendance.md`](./multi-day-partial-attendance.md).
> The points/winner-bonus decisions in §9 remain open and do not block the `'once'`
> check-in path that shipped.

---

## 0. Why / ปัญหา

Today an event is a single time window and `attendance` is `UNIQUE(eventId, studentId)` — a
student checks in **once per event**. Events like **CAMT LINK (18–19 June, 2 days)** need a
check-in **on each day**, which is impossible to express. This adds per-day check-in while
keeping every existing single-day event behaving identically.

Two event behaviours must be supported with **one** mechanism:
- **Register once, attend each day** (event-level registration, per-day check-in).
- **Each day independent** (per-day registration; walk-ins re-open per day).

---

## 1. Design philosophy — sessions subsume "day N"

A new `event_sessions` table: each row is one session (a day, or a morning/afternoon block)
with its own `startTime`/`endTime`. **"Day N" is just the Nth session** ordered by `sortOrder`
(ties by `startTime`). No separate "day" column. A legacy single-day event = an event with
exactly one session. This is Option B; it folds in Option C.

`events.registrationMode` decides what a check-in row means:
- `'once'` — student registers once at event level; that registration is attendable at any/all
  sessions.
- `'per_session'` — student registers (and is counted/quota'd) independently per session.

---

## 2. Schema design (`src/db/schema.ts`)

### New table `event_sessions` (place after `events`, before `attendance`)

| column | type | notes |
|---|---|---|
| `id` | uuid PK `gen_random_uuid()` | |
| `eventId` | uuid NOT NULL FK→events.id `ON DELETE CASCADE` | |
| `title` | text (nullable) | label e.g. "Day 1"; null → derive "Day N" |
| `startTime` | timestamptz NOT NULL | |
| `endTime` | timestamptz NOT NULL | |
| `sortOrder` | integer NOT NULL DEFAULT 0 | stable "day N" ordering |
| `quotaWalkIn` | integer (nullable) | **per-session walk-in sub-cap** (req. walk-ins re-open per day) |
| `createdAt` / `updatedAt` | timestamptz default now() | |

Indexes: `idx_event_sessions_event (eventId)`, `idx_event_sessions_event_order (eventId, sortOrder)`.

`pointsAwarded`, `walkInsEnabled`, `allowedRoles`, `allowedMajors`, targeting stay on `events`
(event-level policy) — not duplicated onto sessions in this pass.

### `events` — add one column

```
registrationMode  text NOT NULL DEFAULT 'once'   -- 'once' | 'per_session'
```
Use `text` + a TS `$type<'once'|'per_session'>()` guard, not a Postgres enum (the codebase
models small closed sets as `text` — see `forms.formType`, `attendance.method`, `users.role` —
and avoids enums, which are painful to alter idempotently). Default `'once'` → every existing
event is backward-compatible with zero behaviour change.

### `attendance` — add `sessionId` (NOT NULL after backfill)

```
sessionId  uuid FK→event_sessions.id ON DELETE CASCADE
```
**Keep `eventId`** (denormalized) — it's read on every hot path (report/export/attendance
list/winner job/register) and keeping it avoids a join everywhere and lets the event-level
winner job aggregate without touching `event_sessions`. `sessionId` is the precise key;
`eventId` is the roll-up. Always derive `eventId` from the chosen session on insert.

`medsCheckOption` already lives on the attendance row → making attendance per-session makes
**meds-check per-session** automatically (req. #4). No new column.

### Unique constraint swap

- Current live object: constraint `attendance_event_student_unique UNIQUE (event_id, student_id)`
  (promoted from index `idx_attendance_event_student` in migrate.ts step 15 — the live object is
  the **constraint**).
- New: `attendance_session_student_unique UNIQUE (session_id, student_id)`. For a `'once'` event
  with one default session this is behaviourally identical to today.

### Legacy mapping — auto-create one default session per existing event

Chosen over a nullable-`sessionId` legacy path: a nullable path forces dual code paths
(`sessionId IS NULL` vs not) through every query, the scanner, and the winner job — exactly the
dual-mechanism the design avoids, and the kind of split that caused the prior scanner multi-PR
loop. Backfilling one session per event makes `sessionId` uniformly NOT NULL → single-path code.
Non-destructive and idempotent (guarded by "only events with zero sessions").

---

## 3. Migration sequence (`src/db/migrate.ts`, append after step 33)

`db:migrate` hits **prod** — rehearse locally first via `/db-local`. All steps idempotent
(`IF NOT EXISTS` / existence guards), non-destructive (no DELETE/DROP COLUMN/lossy).

- **Step 34 — create `event_sessions`**: `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` ×2.
- **Step 35 — add `events.registration_mode`**: `ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_mode text NOT NULL DEFAULT 'once'`.
- **Step 36 — add `attendance.session_id` NULLABLE first** (so existing rows stay legal):
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES event_sessions(id) ON DELETE CASCADE`.
- **Step 37 — backfill one default session per event with none** (idempotent via `NOT EXISTS`):
  ```sql
  INSERT INTO event_sessions (event_id, title, start_time, end_time, sort_order, quota_walk_in)
  SELECT e.id, NULL, e.start_time, e.end_time, 0, e.quota_walk_in
  FROM events e
  WHERE NOT EXISTS (SELECT 1 FROM event_sessions s WHERE s.event_id = e.id);
  ```
  (Copies `events.quota_walk_in` so legacy walk-in caps carry over verbatim.)
- **Step 38 — backfill `attendance.session_id`** from each event's earliest session, where NULL:
  ```sql
  UPDATE attendance a
  SET session_id = (
    SELECT s.id FROM event_sessions s
    WHERE s.event_id = a.event_id
    ORDER BY s.sort_order, s.start_time LIMIT 1
  )
  WHERE a.session_id IS NULL;
  ```
- **Step 39 — ⚠️ the risky unique-constraint swap.** Order matters: **add new BEFORE dropping
  old** so there is never a window without a uniqueness guard against concurrent duplicate scans.
  ```sql
  ALTER TABLE attendance ADD CONSTRAINT attendance_session_student_unique UNIQUE (session_id, student_id);
  ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_event_student_unique;
  ```
  Collision safety: duplicates on `(session_id, student_id)` could only arise if a student had two
  rows for the same event — which the OLD `(event_id, student_id)` constraint already prevented,
  and backfill maps one event → one default session, so no new collision is possible **given step 38
  completed**. Wrap the ADD in a `DO/EXCEPTION` block so a re-run finding it present is a no-op.
  (`CREATE UNIQUE INDEX CONCURRENTLY` can't run inside migrate.ts's implicit transaction over the
  pooler; plain `ADD CONSTRAINT` is acceptable at this data size — document the choice in the step.)
- **Step 40 — enforce NOT NULL** (last, only after backfill+swap):
  `ALTER TABLE attendance ALTER COLUMN session_id SET NOT NULL`. If step 38 missed any row this
  fails loudly **before** an event, not during.

**Ordering rule:** steps 34–40 must be live on prod **before** any code reading `registration_mode`
or writing `session_id` deploys (Migrate-Prod-Before-Deploy). `events.quota_walk_in` is *copied*,
not moved (left in place for backward compat).

---

## 4. `scanner.service.ts` — `processScan()` becomes session-aware

`processScan()` gains a `sessionId: string` param (resolved/defaulted by the API, §5). Load the
session and validate it belongs to the event.

- **Lookup / score gating** (`action 'lookup'|'score'`): participant check is `registrationMode`-aware
  — `'per_session'` → `(sessionId, studentId)`; `'once'` → keep `(eventId, studentId)`. Score itself
  stays event-level (points math parked); scoreHistory writes stay keyed on `eventId`.
- **Pre-registered check-in path:**
  - `'per_session'`: `findFirst (sessionId, studentId)`; dedup on `status==='attended'`; atomic
    confirm `UPDATE ... WHERE id=record.id AND status='registered'` (same logic, per-session row).
  - `'once'` (the subtle case): one event-level registration but attendable across sessions. On
    check-in to a session, look up `(sessionId, studentId)`; if absent **but** the student is
    event-registered, `INSERT` a new attended `(sessionId, studentId)` row (method `'pre-registered'`)
    via `ON CONFLICT (session_id, student_id) DO NOTHING`. Document this in the service.
- **Walk-in path + quota lock:** recount moves to **session** level.
  - Replace the `events`-row `FOR UPDATE` with a lock on the `event_sessions` row
    (`SELECT ... FROM event_sessions WHERE id=sessionId FOR UPDATE`) so sessions don't block each other.
  - Walk-in sub-cap recount: `count(*) WHERE session_id=? AND status='attended' AND method='walk-in'`
    vs `event_sessions.quotaWalkIn`.
  - Overall seat cap (`events.quota`): `'per_session'` → recount attended within the session vs
    `quota`; `'once'` → keep event-level count vs `events.quota` for now + a TODO pointing at the
    parked points doc. Lock **event row then session row** (consistent order) to avoid deadlocks.
  - Insert sets `sessionId` (+ derived `eventId`), `method:'walk-in'`, `ON CONFLICT (session_id, student_id) DO NOTHING`.
- `walkInsEnabled` stays an event-level gate. **PDPA unchanged:** medical signal-vs-detail gating and
  the audit-log-on-medical-access invariant are preserved verbatim; audit strings should append the
  session label (e.g. `... for session "Day 2"`).

---

## 5. Scan API + Scanner UI

### API `src/app/api/admin/scan/route.ts`
- Extend `scanSchema` with `sessionId: z.string().uuid().optional()` (optional → legacy clients still work).
- If `sessionId` omitted, **server-side default to the current session**: the `event_sessions` row
  whose `[startTime,endTime]` contains `now()`; else nearest upcoming; else most recent past
  (deterministic). Pass resolved `sessionId` into `processScan`.
- Validate the session belongs to the event (404 `not_found` otherwise) — blocks a hand-crafted
  cross-event `sessionId`. `confirm`/`score`/`lookup` all forward `sessionId`.

### UI `src/app/admin/scanner/page.tsx`
- Events GET must include each event's `sessions[]` (see §6). Add to the `Event` type.
- Add a **session selector** beside the event dropdown: lists the event's sessions, labeled
  "Day N — date". Default = the session whose window contains now (client-side, matching the server
  default). Store in `sessionId` state **+ `sessionIdRef`** (mirror the existing `eventIdRef` pattern
  so the camera decode callback doesn't capture a stale value).
- Include `sessionId: sessionIdRef.current` in all four fetch bodies (camera `scan`/`lookup`,
  `confirmAttendance`, `confirmScore`, `manualCheckIn`).
- Event with exactly one session → auto-select and collapse the selector so single-day operation is
  visually unchanged. Labels go through `src/lib/i18n/i18n` / `LanguageContext` (EN/TH/MM/CN).

---

## 6. Reporting / admin touch-points

- **`src/app/api/admin/events/route.ts`** — GET returns each event's `sessions[]`. POST accepts a
  `sessions[]` array + `registrationMode`, inserts child `event_sessions` rows in the **same
  transaction** (wrap the existing insert in `db.transaction`); if none supplied, auto-create one
  default session mirroring `startTime/endTime` so create always yields ≥1 session.
- **`src/app/api/admin/events/[id]/route.ts`** — PUT handles add/edit/remove of sessions
  (non-destructive: block deleting a session that has attendance). Event DELETE still cascades
  (`event_sessions` via FK `ON DELETE CASCADE`); confirm existing manual `tx.delete(attendance)`
  ordering still holds (it does).
- **`src/app/admin/events/page.tsx`** (large — the event create/edit forms) — add a sessions editor
  (repeatable rows: start/end/label/per-session walk-in quota) + a `registrationMode` toggle; submit
  `sessions[]` + `registrationMode`. Largest UI change.
- **`src/app/api/admin/events/[id]/attendance/route.ts`** — add optional `?sessionId=` filter + session
  label per row; keep the medical-access audit log, append session context.
- **`src/app/api/admin/events/[id]/report/route.ts`** + **`/export/route.ts`** — add a **Session**
  column, tally per session; keep the audit-log line.
- **`src/lib/points/award-points.ts`** (`checkAndAwardPastEventPoints`) — **parked points hook.** Today counts
  `attendance WHERE eventId AND status='attended'` grouped by house, gated on `events.endTime` +
  `winnerAwardedAt`. The per-session-winner-vs-aggregate decision lives here. **Do not change the math
  now** — add a TODO pointing at `multi-day-points-policy.md`. ⚠️ Note: in `'once'` mode a student
  attending N sessions yields N attended rows, which would inflate the aggregate house count — the
  parked doc must resolve whether to `COUNT(DISTINCT student_id)` per house or award per-session. A
  future `event_sessions.winnerAwardedAt` may be needed if the policy goes per-session (not added now).
  Existing single-session events are unaffected (one session) — confirm.
- **`src/app/api/events/[id]/register/route.ts`** — `'once'` events register event-level (one row vs
  the default/first session, `sessionId` derived); `'per_session'` registers against a specific session
  (needs a session param + per-session quota recount mirroring the existing `FOR UPDATE` pattern). The
  K_pre pre-test gate is unaffected.

---

## 7. Risks, ordering & verification

**Migrate-before-deploy:** steps 34–40 must be live on prod **before** code reading `registration_mode`
or writing `session_id` deploys — a code deploy ahead of the migration would 500 the scanner mid-event.

**Risks:**
- Backfill correctness — every legacy event gets exactly one default session; every legacy attendance
  row points at it. Verify counts before the NOT NULL/constraint steps.
- Step 39 (constraint swap) is the highest-risk: add-new-before-drop-old, depends on step 38 backfill.
- `'once'`-mode multi-session check-in creating multiple attended rows per student inflates the
  house-winner aggregate — flagged/parked; single-session events unaffected.
- Scanner is the most regression-prone subsystem — `smo` scanner-only confinement and the 4-layer admin
  gating (`src/proxy.ts` runs first) must be re-confirmed unchanged; no new route segment bypasses the gate.
- PDPA: medical signal-vs-detail gating + audit-on-access preserved verbatim; per-session `medsCheckOption`
  still written on the (now per-session) row.

**End-to-end verification:**
1. Rehearse the full migration on local Docker DB via **`/db-local`** (never prod); assert post-backfill
   counts (sessions == events; attendance with non-null `session_id` == total attendance).
2. Run **`/scanner-verify`** against local — guards the scan path + PDPA gating invariant this touches.
3. Manual matrix: (a) legacy single-session event identical (register→scan→confirm→already-checked-in→
   walk-in quota); (b) multi-session `'per_session'`: walk-in quota re-opens per day, meds-check per day,
   day selector defaults to today + overrides; (c) multi-session `'once'`: register once, check in across
   two sessions.
4. `npm run lint` + `npm run build` → `/recheck` the diff → deploy via `/safe-deploy`.

---

## 8. Critical files

**Primary:** `src/db/schema.ts`, `src/db/migrate.ts`, `src/modules/events/scanner.service.ts`,
`src/app/api/admin/scan/route.ts`, `src/app/admin/scanner/page.tsx`.

**Secondary (session-aware roll-up):** `src/app/api/admin/events/route.ts`,
`src/app/api/admin/events/[id]/route.ts`, `src/app/admin/events/page.tsx`, `src/lib/points/award-points.ts`,
and the attendance/report/export routes under `src/app/api/admin/events/[id]/`.

---

## 9. Blocked-on decisions (from the policy docs)

- [ ] Individual-points model: per-day / all-or-nothing / once — `multi-day-points-policy.md §2.1`.
- [ ] House winner bonus: per-day vs aggregate — `multi-day-points-policy.md §2.2`.
- [ ] Strike definition on multi-day events — `multi-day-points-policy.md §3`.
- [ ] Partial-attendance completion definition + report labels — `multi-day-partial-attendance.md`.

---

## 10. Deferred: `'per_session'` registration (hidden in UI)

**What shipped:** only `registrationMode = 'once'` — a student registers **once** at the
event level and that single registration is attendable on **every** day. On each day the
scanner sees the event-level registration and creates that day's `attended` row
automatically (`scanner.service.ts`, the once-mode fallback). This is the mode CAMT LINK
(18–19 June) uses, and it is fully working and dry-run verified.

**Why `'per_session'` is hidden:** the option existed in the event editor, but the
**student registration flow was never made session-aware**. `POST /api/events/[id]/register`
always inserts exactly **one** `registered` row anchored to the *first* session
(`register/route.ts` — no `registrationMode` branch), and nothing anywhere creates a
per-day registration row. `'per_session'` deliberately disables the scanner's once-mode
fallback, so a student who "registered" and shows up on Day 2 has **no Day-2 registered
row to flip** → they fall through to the **walk-in** path (rejected if walk-ins are off,
or mis-counted against walk-in quota if on). Net: selecting `'per_session'` produces a
**silently broken event**.

**Decision (2026-06-19):** hide the `'per_session'` radio in the editor
(`src/app/admin/events/page.tsx`, the registration-mode options array — the option is
commented out, not deleted) so only `'once'` is selectable. The DB column, the
`schema.ts` type, and the scanner's `'per_session'` branch are **left intact** for the
future build; nothing destructive was removed.

**To re-enable `'per_session'` later, build the missing half first:**
1. A **per-day student registration** path — let a student register for specific
   session(s); insert one `registered` row **per chosen session** (not just the first).
2. **Per-session quota** accounting on registration (seats counted per `sessionId`, not
   `count(distinct studentId)` over the whole event).
3. Editor UX for per-day registration windows / quotas.
4. **Server-side guard (recommended):** until 1–3 exist, also reject
   `registrationMode = 'per_session'` in the create/update zod schemas
   (`src/app/api/admin/events/route.ts`, `[id]/route.ts`) so a hand-crafted request
   can't create a broken event even with the UI option hidden. (Not added in this ship —
   the editor is the only path that set it, and no prod event uses `'per_session'`.)

Then un-comment the editor option and remove this deferral note.
