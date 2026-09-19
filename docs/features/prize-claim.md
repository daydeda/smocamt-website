# Prize claim (การรับรางวัล / การรับของ)

**Status:** implemented on `feat/prize-claim` (schema + migration `drizzle/0042`,
`PrizeService`, admin routes, `/admin/prizes` tab, both report renderings).
NOT yet run against a database — `npm test`/`lint`/`build` pass, but the suite
covers pure logic only, so the claim/report SQL and the booth flow still need
`/verify` against a local DB before a PR. Written 2026-09-19 and revised twice
the same day: once after the "แจกแก้ว" case showed the first model was wrong
(see "Why the prize is not owned by an event"), once after the report turned out
to need both an `.xlsx` and a PDF.

**Known gaps:** the admin UI strings are hardcoded Thai rather than routed
through `src/lib/i18n.ts` in all four languages (EN/TH/MM/CN) — deliberate for
the booth screens, which are staffed in Thai, but it is a deviation from the
repo's i18n rule and should get a proper pass. Only the nav label
(`managePrizes`) is translated. The claim-list/รอรูป follow-up view and prize
editing exist in the API (`GET`/`PATCH /api/admin/prizes/[id]`,
`PrizeService.listAwaitingPhoto`) but have no UI yet.

## Problem

Two shapes of handing something to a student, which look different but are the
same record:

1. **ผู้ชนะ / จับฉลาก in an event.** One event can have several distinct
   prizes, and each prize can have several winners (3+ is normal).
2. **แจกของนอกรอบ** — e.g. แจกแก้ว. A student may collect days later, at a
   counter, not at the event. **One student may collect exactly once**, and
   that limit has to hold no matter which staffer, which day, or which counter
   they show up at.

For both, the faculty needs a record that survives into a report sent to the
**dean**: ชื่อจริง–นามสกุล, รหัสนักศึกษา, วันที่เข้าร่วมกิจกรรม, วันที่ได้รับของ,
รางวัลที่ได้รับ, and a photo of the student holding the item as proof the
handover happened.

## Why the prize is not owned by an event

The first draft of this design made prizes rows under an event
(`event_prizes.eventId NOT NULL`) and enforced "no duplicates" with a unique
index on `(prizeId, studentId)`.

**That is exploitable exactly the way แจกแก้ว is worried about.** If the same
physical giveaway gets a prize row under event A and another under event B — 
which is what naturally happens when collection drags on past the event, or
when a second pickup session is opened — then `prizeId` differs, the unique
index does not fire, and one student legitimately collects two แก้ว. Nobody
notices until stock runs out.

So: **a prize is a first-class entity that may optionally be attached to an
event, not a child of one.** The uniqueness domain is the prize itself. One
`prizes` row for แจกแก้ว, claimable at the event, at the counter next week, or
by a different staffer entirely — still one row per student, enforced by the
database, not by whoever is watching the table.

A separate admin tab (your instinct — correct) follows from this, but it is
worth being precise about why: **the tab is not what stops the duplicate, the
uniqueness anchor is.** A separate tab over a still-event-owned prize would
look tidy and stay just as exploitable. The tab is the right UI *because* the
prize now genuinely outlives the event.

## What this is NOT

- **Not the shop.** `shop_orders` assumes a buyer, a price, and a payment
  slip. A prize has none of those.
- **Not a new attendance mode.** Prize claim must never create or imply an
  `attendance` row, and must not touch points / quota / strikes — the same
  wall `calendar_entries` has against the scoring paths.

## What this DOES reuse

| Need | Reuse |
|---|---|
| Identify the student without typing | the rotating-HMAC QR (`src/lib/qr-token.ts`) + `ScannerService` |
| Store the proof photo privately | private `form-uploads` bucket + `src/lib/form-file-storage.ts`, as `attendance.evidenceFileKey` does |
| Serve the photo safely | auth-guarded stream modelled on `api/attendance/evidence/[attendanceId]` |
| Log who viewed it | `AuditService.logAction` |
| Scope who may award | `EventScopeService`, `src/lib/event-access.ts`, `src/lib/admin-access.ts` |
| Shrink the photo | `src/lib/compress-image.ts`, 5MB cap client + server |
| Spreadsheet export | `exceljs` (photos must embed — see the report section); other exports keep `xlsx` |
| PDF | none — a print-styled page, ⌘P from the browser |

## Data model

### `prizes` — a giveaway, standing on its own

```
id                 uuid pk
name               text not null          -- "แก้ว CAMT", "รางวัลที่ 1"
description        text
eventId            uuid -> events.id (set null)   -- OPTIONAL context, NOT ownership
rank               integer                -- report ordering; NULL = unranked/ลุ้นโชค
quantity           integer                -- soft target; NULL = unlimited
onePerStudent      boolean not null default true
requireCheckIn     boolean not null default false
eligibilityEventId uuid -> events.id (set null)   -- must have attended THIS event
status             text not null default 'open'   -- 'open' | 'closed'
sortOrder          integer not null default 0
createdBy          text -> users.id (set null)
createdAt / updatedAt
```

`eventId` is **`SET NULL`, not cascade** — deleting an event must never delete
the record that แก้ว was handed to 200 students.

The three flags are what let one table serve both shapes:

- **`onePerStudent`** (default `true`) — แจกแก้ว. Set `false` only for a prize
  that can legitimately repeat.
- **`requireCheckIn` + `eligibilityEventId`** — your answer to "แล้วแต่กิจกรรม".
  Note these are deliberately **two different columns from `eventId`**: "which
  event you must have attended to be eligible" is not the same question as
  "which event this prize belongs to." แจกแก้ว is exactly that case — eligibility
  comes from the event, collection happens weeks later at a counter. When
  `requireCheckIn` is on, the claim is refused unless the student has an
  `attendance` row with `status: 'attended'` for `eligibilityEventId`.
- **`status: 'closed'`** — stops new claims without deleting anything.

### `prize_claims` — one row per physical handover

```
id            uuid pk
prizeId       uuid -> prizes.id (cascade)  not null
studentId     text -> users.id (cascade)   not null
eventId       uuid -> events.id (set null) -- where it was handed over, if at one
claimedAt     timestamptz not null default now()   -- วันที่ได้รับของ
claimedBy     text -> users.id (set null)          -- the staff who handed it over
method        text  -- 'qr' | 'manual'
photoKey      text  -- key in the private bucket; NULL = ยังไม่มีรูป
note          text
createdAt / updatedAt

unique index (prizeId, studentId)  WHERE one_per_student  -- see note
index (prizeId), (studentId), (claimedAt), (eventId)
```

**The anti-duplicate guarantee is the unique index, and it must be in the
database.** A UI check ("this student already claimed") loses to two staffers
scanning the same student on two phones in the same second. Postgres does not.
Since `onePerStudent` lives on `prizes` rather than on the claim, the partial
index needs the flag denormalised onto `prize_claims` (a
`one_per_student boolean not null` column, copied at insert, kept consistent by
the service) — a small ugliness, bought deliberately, because the alternative
is enforcing the rule in application code where the race lives.

Other deliberate choices:

- **`prizeName` snapshot** on the claim (`shop_order_items.productName`
  pattern): renaming a prize later must not rewrite a report already sent to
  the dean.
- **No `studentName` / `studentIdNumber` columns.** Joined from `users` at read
  time — copying identity fields is duplicated PII that goes stale the moment a
  student corrects their name (`docs/features/name-schema-handoff.md`).
- **Claims are never hard-deleted by a normal flow.** Revoking a wrongly-given
  prize should be an explicit, audit-logged super_admin action, not a delete
  button next to every row.

## Flow

### Admin surface: a separate top-level tab

`/admin/prizes` — the primary surface, matching the fact that a prize outlives
its event:

- **List**: every prize with claimed / quantity, status, and a รอรูป counter.
- **Prize detail**: configure it, award from it, see its claim list, export.

The per-event page gets a **read-only pane** linking to the prizes whose
`eventId` is that event. One table, two views — not a second system.

`src/proxy.ts` must gain `/admin/prizes` in the same PR as the layout gate and
AdminNav. This is the layer that caused the 5-PR scanner loop.

### Awarding

Pick the prize → scan the student's QR (the same camera component
`/admin/scanner` uses) → the card resolves **name + รหัสนักศึกษา from the DB**
→ staff taps ยืนยัน.

Staff types nothing. A booth with a queue is the worst possible place to
hand-enter a 9-digit รหัสนักศึกษา, and a typo produces a row pointing at nobody
that surfaces on report day. Manual entry stays as a fallback
(`method: 'manual'`) behind a search picker that resolves to a real `users.id`,
never free text.

The scan result screen must state the refusal reason plainly, because it is the
whole anti-fraud UX: **"รับไปแล้วเมื่อ &lt;วันที่&gt; โดย &lt;staff&gt;"** for a
duplicate, **"ยังไม่ได้เช็คอินกิจกรรม &lt;ชื่อ&gt;"** for a failed eligibility
check.

Two properties that make this hard to cheat, worth stating since they're the
reason the design is scan-first:

1. The QR is a **5-minute rotating HMAC** (`qr-token.ts`). A screenshot sent to
   a friend so they can collect แก้ว on your behalf is dead within 5 minutes.
2. The duplicate check is **per prize, not per event or per session**, so a
   second pickup counter opened next month is still the same uniqueness domain.

### The photo

**Optional at save time, chased afterwards.** After ยืนยัน the screen
immediately offers ถ่ายรูป, but the claim row is already committed.
Hard-requiring the photo means that the day the venue wifi dies, staff stop
recording claims entirely and the report is simply missing people — and worse
for แจกแก้ว, the duplicate check stops running too.

The prize list shows a **รอรูป (n)** counter; the photo can be attached later
from the claim row. The dean report renders a visible placeholder for a missing
photo rather than silently dropping the winner.

Upload: `compress-image.ts` client-side → 5MB server cap →
`form-file-storage.ts` → key in `photoKey`. **Never a public URL.** Served by
`GET /api/admin/prizes/claims/[claimId]/photo`, mirroring the evidence route:
the student themself or scoped staff only, and every third-party view writes an
audit log (best-effort try/catch — an audit hiccup must not block the view).

### The dean report — two renderings of one query

**Decision (2026-09-19): both an editable `.xlsx` and a print-to-PDF page, from
a single data layer.** Not one or the other, because they do different jobs and
neither can do the other's.

The deciding constraint is an Excel behaviour, not a preference. **A picture in
an `.xlsx` is a floating object anchored over cells, not cell content.** When
someone sorts or filters the sheet — e.g. reorders by รหัสนักศึกษา to find a
name — the data rows move and **the images do not follow them**. Every photo
then sits beside the wrong student.

In an ordinary spreadsheet that is an annoyance. In a document whose entire
purpose is proving who received what, it is corruption of the evidence, and it
happens **silently**: the person who sorted the sheet was just trying to make it
easier to read, and nothing warns them.

"Editable" and "photo permanently bound to the right name" cannot both hold in
one file. So they are split:

| Artefact | Job | Photos |
|---|---|---|
| **`.xlsx`** | the working file — faculty may sort, filter, add columns, reuse the data | embedded, **plus a warning line in the header note that sorting will not move them** |
| **PDF** (print page) | the record actually sent to คณบดี — photo↔name binding fixed, layout controlled | fixed in flow, cannot drift |

Both read **the same `PrizeService` query**. The split is at the rendering
layer only, so there is no second source of truth whose numbers can drift from
the first — which was the main argument against building two exports, and it
does not apply when the data layer is shared.

The PDF side adds **no dependency**: `/admin/prizes/[id]/report` is a
print-styled page, staff presses ⌘P → Save as PDF. A useful side effect is that
**Thai rendering becomes the browser's problem rather than ours** —
สระ/วรรณยุกต์ stacking and Thai word-break are a well-known source of broken
output in server-side PDF libraries.

#### The `.xlsx` side

Embedding photos forces a library change for this one route. `xlsx` — the SheetJS
**community** build this repo pins — cannot embed images; image support is a
SheetJS Pro feature. So the prize report is written with **`exceljs`**
(added as a dependency), whose `worksheet.addImage` anchors a real picture into
a cell range. Every other export in the repo keeps using `xlsx`; this is a
deliberate, scoped exception rather than a migration, and it is worth a comment
at the top of the route saying so, because "two spreadsheet libraries" otherwise
reads as an accident.

`GET /api/admin/prizes/[id]/export` (Node runtime — `exceljs`, like `xlsx`, is
not edge-safe) produces one sheet:

| ลำดับ | ชื่อ–นามสกุล | รหัสนักศึกษา | รางวัล | วันที่เข้าร่วมกิจกรรม | วันที่ได้รับของ | ผู้แจก | รูปถ่าย | หมายเหตุ |
|---|---|---|---|---|---|---|---|---|

- **วันที่เข้าร่วมกิจกรรม** = the student's own `attendance.checkInTime` when
  they have one, else the event's `startTime`, else blank.
- **วันที่ได้รับของ** = `claimedAt`.
- **รูปถ่าย** = the photo embedded in the cell. A claim still รอรูป gets the
  literal text `— ไม่มีรูป —` in that cell instead of being silently dropped,
  so the gap is visible to whoever reviews the file.
- Dates are written as **real Excel date cells** with a `dd/mm/yyyy HH:mm`
  format, not preformatted strings — otherwise sorting the column in Excel
  sorts alphabetically, which is exactly the kind of thing that makes an
  "editable" report useless the first time someone sorts it.
- Header row frozen + autofilter, matching the existing event export. The
  autofilter is deliberately still enabled — the sheet is *meant* to be sorted;
  the note row above the header states plainly that **รูปถ่ายจะไม่เลื่อนตามเมื่อ
  sort/filter — ให้ยึดไฟล์ PDF เป็นหลักฐาน** so the reader knows which artefact
  is authoritative.

**Photos are thumbnailed server-side before embedding, with `sharp`** (already a
dependency): longest edge ~320px, JPEG. A 5MB phone photo per row would make a
200-winner report a ~1GB file that Excel refuses to open. At 320px it is roughly
25–40KB per row, so a 200-row report lands in single-digit MB.

Two consequences to build for, not discover later:

- **Generation is O(claims) in memory** — it downloads every photo from the
  private bucket, resizes, and buffers the workbook. Fine at a few hundred
  rows; it needs a guard (and a date-range / event filter on the route) before
  someone generates a report for a giveaway with thousands of claims.
- **PDPA: this file is the loosest artefact the feature produces.** Names +
  รหัสนักศึกษา + face photos, in one file, designed to be forwarded and edited.
  That is the whole point of the deliverable, so the controls sit around it
  rather than in it: generation is audit-logged as an export (not just a view),
  and `smo` cannot generate it at all (see Access control).

#### The PDF side

`/admin/prizes/[id]/report` — a server-rendered, print-styled page over the same
query: prize header (name, event, date range), then one block per claim with
ชื่อ–นามสกุล, รหัสนักศึกษา, วันที่เข้าร่วมกิจกรรม, วันที่ได้รับของ, ผู้แจก and the photo
inline, plus a signature/date line at the end for the faculty's own process.

Photos here load through the **same auth-guarded claim-photo route** as the rest
of the app, which is why the page is PDPA-safe by construction: it cannot render
for anyone who is not already authorised, and each photo fetch is audit-logged
like any other. `@media print` hides the app chrome and sets page breaks so a
claim never splits across pages.

Same access gate as the `.xlsx` (not `smo`), and opening it is audit-logged as
an export, not a view — it is the whole roster on one screen.

## Access control

Four layers move together (`proxy.ts` → admin layout → `admin-access.ts` →
server-side route gates). Route gates remain the real source of truth.

| Action | Who |
|---|---|
| Create / configure / close a prize | `super_admin`, `admin`, `organizer`; `club_president`/`major_president` for prizes attached to an event they own |
| **Award (scan + ยืนยัน + ถ่ายรูป)** | the above **plus `smo`** |
| View claim list for a prize | the above |
| Dean report — `.xlsx` export **and** the PDF print page | **not `smo`** — see below |
| Delete a photo | **`super_admin` only** |
| Revoke a claim | `super_admin`, `admin` |

**`smo` can award** (your decision). That means extending the scanner-style
confinement — `smo` may now reach `/admin/prizes` in addition to
`/admin/scanner`, exactly the pattern `/admin/shop` already uses for
`shop_seller`/`club_president`. AdminNav must show only those two entries for
`smo`, and `src/lib/admin-access.ts` needs a new predicate (`canAwardPrizes`)
rather than an inline role-array copy — the predicate is what proxy, layout,
and nav all import.

I am **recommending `smo` be excluded from the report/export** even though they
can award. Awarding is one student at a time, in person, with that student
standing there. The export is the whole roster of รหัสนักศึกษา + names + face
photos in one downloadable file — a much easier thing to forward. This is the
same "ask an admin for the file" split the event export already applies to
`smo` (`api/admin/events/[id]/export`: `smo` gets a thin roster). Flagging it
rather than assuming it: say if you want them to have the export too.

## PDPA

A photo of an identifiable student's face, collected specifically to be
**disclosed to a third party (คณบดี)**. Consent notice is mandatory, not a
nicety.

1. **Notice at capture.** A short Thai line on the award screen before the
   photo: what is collected, that it goes in a report to คณบดี, how long it is
   kept.
2. **Private storage only.** Same bucket and guarantees as evidence photos.
   **Publicity is out of scope**: if the SMO later wants these for the page,
   that is a separate opt-in column and a separate conversation, never a quiet
   reuse of accountability photos.
3. **Audit every third-party view** and every export.
4. **Retention: indefinite, deleted only by `super_admin`** (your decision).
   Consequences that follow from that and should be built, not assumed:
   - **No `retention-sweep` entry for these photos.** Worth writing into the
     sweep's own docs as a deliberate exclusion, so a future cleanup pass
     doesn't "helpfully" add them.
   - Deleting the **photo** and deleting the **claim** are different actions.
     Almost always you want to drop the photo (the PDPA-heavy part) while
     keeping the record that the student received the item — otherwise the
     duplicate check forgets them and they can collect a second แก้ว. Build the
     photo delete as `photoKey → NULL` + object removed + audit; keep the row.
   - Indefinite retention is a defensible choice for an accountability record,
     but it is the kind of thing a PDPA review asks about. The audit log is the
     answer, so the audit coverage has to be real.

## Migration

One additive migration: two tables + indexes, `CREATE TABLE IF NOT EXISTS` /
`CREATE INDEX IF NOT EXISTS`. No `DELETE`, no drops, nothing touching an
existing table. Generated with `npm run db:generate`, never hand-edited after,
run on prod via `npm run db:migrate:container` from the Portainer console
**before** the image is recreated (`/safe-deploy`).

## i18n

All strings through `src/lib/i18n.ts` in EN/TH/MM/CN. TH is the operational
language here (booth staff + the dean report), so write TH first and derive EN.

## Build order

1. Schema + migration (`prizes`, `prize_claims`) — `drizzle-migration-author`.
2. `PrizeService` (`src/modules/events/prize.service.ts`): claim, eligibility
   check, duplicate handling, revoke, scope predicates. Logic here, not in
   route handlers.
3. `canAwardPrizes` in `admin-access.ts` + `proxy.ts` + admin layout + AdminNav
   — one PR, four layers.
4. `/admin/prizes` tab: list, configure, award (scanner camera component).
5. Photo upload + auth-guarded serving route + audit.
6. Reporting, both over the same `PrizeService` query, both audit-logged as
   exports: (a) `.xlsx` with embedded photos (`exceljs` + `sharp` thumbnails),
   (b) the print-to-PDF page.
7. Unit tests for the eligibility/duplicate predicates (`test-author` — pure
   logic, the part Vitest can actually cover), i18n pass,
   `pdpa-access-guard` review, `/recheck`, `/safe-deploy`.
