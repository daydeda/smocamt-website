# Handoff — Separate Given Name / Family Name (แยกชื่อจริง-นามสกุล)

> **STATUS: REVISED AFTER SECOND REVIEW. PENDING FINAL APPROVAL.**
> No code, schema, or migration exists yet. Revision 2 corrects six points raised
> in the second review pass; §12 records what changed and why. §9 lists the
> questions that still need a decision before implementation starts.

---

## 1. The question

Should `users.name` (one `notNull` text column holding a full name) be split into
separate given-name and family-name columns, to make the student directory,
sorting, and Excel/CSV exports easier to work with?

**Recommendation: yes, with an explicit confirmation marker, and a first slice
scoped to capture plus review rather than exports.** Reasoning in §3 and §4.

---

## 2. What was verified against the code

Every claim below was checked directly. Evidence is included so a reviewer can
confirm it independently rather than taking this document's word.

| Claim | Verdict | Evidence |
|---|---|---|
| Directory downloads all users and filters in the browser | **Confirmed** | `src/app/api/admin/students/route.ts:38` — `findMany` with no `limit`, `offset`, or `where`. Filtering at `src/app/admin/students/page.tsx:425` |
| Name validation is inconsistent across write paths | **Confirmed** | `src/app/api/profile/route.ts:25` uses `z.string().min(1)`, so `" "` passes and there is no max length. `src/app/api/admin/users/[id]/route.ts:79` destructures `name` from the body with no Zod validation at all |
| Existing names cannot be split reliably by code | **Confirmed, and stronger than stated** | The app ships EN/TH/**MM**/CN translations (`src/lib/i18n.ts`), so Myanmar and Chinese students are a supported group. Burmese names frequently have no surname; Chinese names do not split on "first space" |
| `src/db/migrate.ts` is part of the change | **Confirmed** | It carries hand-rolled `ADD COLUMN IF NOT EXISTS` patches (`src/db/migrate.ts:38` onward), not just generated Drizzle output |
| `admin/dashboard/route.ts` is an export surface | **Confirmed** | Emits an attendance CSV at `:102`–`:161` |
| Songsue should keep exchanging the combined name | **Confirmed** | `src/lib/songsue-sync.ts:33,65,75` types `name: string` on the wire |
| There are 7 export surfaces, not 12 | **Confirmed (correction to rev 1)** | See §7 |

---

## 3. What splitting does and does not buy

**It does not improve substring findability.** The directory predicate at
`src/app/admin/students/page.tsx:427-430`:

```ts
const fullName = `${s.prefix || ""}${s.name || ""}`.toLowerCase();
const matchesSearch = fullName.includes(debouncedSearch.toLowerCase()) ||
  s.studentId?.includes(debouncedSearch) ||
  s.nickname?.toLowerCase().includes(debouncedSearch.toLowerCase());
```

A substring match over the full name already hits on either the given name or the
surname, so ordinary "type a few letters" lookup is unchanged by this proposal.
The unbounded `findMany` is a separate pagination problem, orthogonal to this.

**It does enable three things that are impossible today:**

1. **Reversed-name queries.** Searching `"ใจดี สมชาย"` (surname first) against a
   stored `"สมชาย ใจดี"` fails today. With split fields it can match.
2. **Field-specific filtering.** "Everyone with surname X" is not expressible
   against a single combined column.
3. **Surname sort**, if wanted. See the open question in §9.

**The driver that justifies the work: Thai official paperwork.** Thai forms
almost always carry separate ชื่อ and นามสกุล boxes. This repo contains
`docs/manual-tor-srs/` and workload reimbursement forms. If student names are
transcribed into official CMU documents by hand, or will be generated from this
data, structured fields pay for themselves. **If that driver is not real, the
recommendation weakens considerably**; see §9 Q1.

---

## 4. Storage model

Three columns, and the third one is what makes the design work:

```
users.name              unchanged, notNull, remains the authoritative display name
users.given_name        nullable, written ONLY on human confirmation
users.family_name       nullable, written ONLY on human confirmation
users.name_confirmed_at nullable timestamptz, NULL = never confirmed
```

`name_confirmed_at` exists because `family_name IS NULL` is otherwise ambiguous
between two very different states:

| State | given_name | family_name | name_confirmed_at |
|---|---|---|---|
| Never confirmed | NULL | NULL | **NULL** |
| Confirmed, has surname | `สมชาย` | `ใจดี` | timestamp |
| Confirmed mononym (no surname) | `Aung` | NULL | timestamp |

Everything downstream keys off `name_confirmed_at IS NOT NULL`, not off whether
`family_name` happens to be populated.

**Guessed splits are never persisted, and never leave the review UI.** A
suggestion exists for exactly one purpose: to make human confirmation cheap. It
is not data, it does not reach exports, and it is not stored. See §5.

---

## 5. Suggestions: review UI only

A new `src/lib/person-name.ts` provides `suggestSplit(name)`. Pure logic, no I/O,
fully covered by this repo's Vitest setup.

| Input shape | Suggestion |
|---|---|
| Exactly one space, both sides non-empty, Thai or Latin script | `given` = part 1, `family` = part 2, **confident** |
| No space (mononym) | `given` = whole string, `family` = empty, **needs review** |
| Two or more spaces (compound surname) | **needs review**, no guess offered |
| Myanmar or Chinese script detected | **needs review**, no guess offered |

It deliberately declines to guess on exactly the cases that make bulk
auto-splitting unsafe.

**Where suggestions may appear:** the admin review screen, and a student's own
profile prompt. Both are confirm-or-correct interfaces where a human sees the
guess, next to the original `name`, and accepts or fixes it.

**Where suggestions must never appear:** any export, any official document, any
API response consumed as data, and the database. A `verified=false` column in a
spreadsheet is not an adequate guard, because columns get dropped, filtered away,
or copy-pasted out of context, and the resulting harm is a wrong name on official
CMU paperwork. Exports therefore emit split columns **only** for rows where
`name_confirmed_at IS NOT NULL`, and leave them blank otherwise. `name` continues
to be exported unchanged for every row.

`prefix` (`src/db/schema.ts:61`) stays a separate column and is never folded into
either field. This matches current behaviour, which concatenates without a space
in Thai style (`${s.prefix || ""}${s.name || ""}`).

---

## 6. The compose invariant (highest-risk item)

`users.name` is `notNull` (`src/db/schema.ts:62`). The helper that maintains it
must be fallback-preserving, must never blank it, and **must support a confirmed
mononym**:

```ts
compose(given, family, existingName): string {
  const g = given?.trim();
  if (!g) return existingName;              // nothing confirmed → leave name alone
  const f = family?.trim();
  return f ? `${g} ${f}` : g;               // confirmed mononym → given name alone
}
```

Requiring *both* parts would silently discard the confirmation of any student who
has no surname, which contradicts the "support people without surnames" decision.
The guard is on whether a given name was confirmed, not on both fields present.

Failure scenario if this is got wrong: a compose that returns `""` passes the
`notNull` constraint silently. `src/app/api/admin/users/[id]/route.ts:79`
currently accepts `name` from the request body **with no validation**, so that is
precisely the path where a blanking write would land.

The blast radius is worse than blank UI. That same route writes audit entries as
`` `Updated user ${targetUser.name}: …` `` (`:214`) and
`` `Deleted user account: ${targetUser.name}` `` (`:276`). Audit logs are
append-only and hash-chained, so blanked names get permanently baked into audit
history and cannot be corrected afterwards.

Both branches need explicit unit tests, including the blanking regression.

---

## 7. Scope

### Phase 1 — capture and confirm

The review UI is **in** Phase 1, not deferred. It is the mechanism that actually
populates the data; without it the columns stay empty, because students do not
return to edit their profiles.

1. `src/db/schema.ts` — add nullable `given_name`, `family_name`, `name_confirmed_at`
2. Generated Drizzle migration + matching `ADD COLUMN IF NOT EXISTS` patch in `src/db/migrate.ts`
3. `src/lib/person-name.ts` — `suggestSplit`, `compose`, `resolveName` + `src/lib/person-name.test.ts`
4. `src/app/onboarding/OnboardingClient.tsx` — replace the single ชื่อ-นามสกุล input at `:438` with two fields; sets `name_confirmed_at` on submit
5. `src/app/api/profile/route.ts` + `src/app/dashboard/profile/page.tsx` — edit both fields
6. `src/app/api/admin/users/[id]/route.ts` — accept both fields, **and add the Zod validation it currently lacks**
7. `src/app/admin/students/page.tsx` — a "needs review" filter plus an inline confirm-or-correct control pre-filled from `suggestSplit`. Target: a few seconds per student, so staff can clear a cohort in one sitting
8. `src/lib/i18n.ts` — new labels in **all four** languages (EN/TH/MM/CN), not just EN/TH

Validation shared by every write path: trim, reject whitespace-only, sane max
length, preserve Unicode, reject control characters.

### Phase 2 — consume (after the data is populated)

Export columns (gated on `name_confirmed_at`), reversed-name and field-specific
search, surname sort, and any indexes. Revisit once confirmation coverage is
high enough to be useful.

**Export inventory (corrected from rev 1: 7 surfaces, not 12).**

Server-side emitters carrying student identity:
`admin/clubs/[id]/members/export`, `admin/majors/[code]/members/export`,
`admin/events/[id]/export`, `admin/events/[id]/report`, `admin/dashboard` (CSV).

Genuine client-side XLSX builders:
`AdminShopClient.tsx:173`, `EventFormBuilderModal.tsx:879`.

Not export surfaces (rev 1 counted these in error): `admin/clubs/page.tsx:166`,
`MajorTeamSection.tsx:138`, and `admin/events/page.tsx:1720` are `a.href`
download triggers pointing at the server routes above;
`admin/events/[id]/attendance` and `admin/shop/products/[id]/orders` are JSON
endpoints, not file emitters.

### Explicitly out of scope

- **Bulk backfill of existing names.** Never. This is the core safety property.
- **Persisting any suggested split.** Suggestions are UI-only, always.
- **Removing or renaming `name`.** It stays, in the manner of the legacy
  `users.position` column, kept rather than dropped for the same
  non-destructive reason.
- **Changing the directory search predicate in Phase 1.** See §10.
- **Songsue integration.** Keeps exchanging the combined `name` unless that API
  is upgraded separately.
- **Indexes.** Deferred until search moves server-side, per §9 Q4.

---

## 8. Testing

`vitest.config.ts` forces `DATABASE_URL=""` / `pglite` and the suite is
pure-logic only. That constrains *where* logic must live, not what can be tested:
**extract the name-to-row mapping for each export into a pure helper and Vitest
covers it**, rather than relying on manual verification.

**Vitest covers:**
- `suggestSplit` across Thai, Latin, Myanmar, and Chinese inputs
- Apostrophes, hyphens, multi-word surnames, mononyms
- Leading/trailing and repeated whitespace normalisation
- `compose`: both-parts, confirmed-mononym, nothing-confirmed, and the blanking regression (§6)
- `resolveName` gating on `name_confirmed_at`
- Rejection of blank and oversized values
- Export row-mapping helpers, including that unconfirmed rows emit blank split columns
- `csvCell` escaping and formula-injection safety for the new values

**Needs `/verify` or `/db-local` (not unit-testable here):**
- Route wiring, auth gating, and the actual XLSX binary output
- Songsue and Auth.js behaviour with the composed name
- Migration rehearsal against existing records

**Validation sequence:** `npm test` → `npm run lint` → `npm run build` (there is
no separate `typecheck` script; the Next build runs tsc) → `/verify` →
`/db-local` migration rehearsal → `/safe-deploy`.

Per CLAUDE.md, the production migration must run via `npm run db:migrate:container`
from the Portainer console **before** any code that reads the new columns is
deployed. The migration is additive, idempotent, and non-destructive.

---

## 9. Open questions

1. **Is the official-paperwork driver real?** If nobody transcribes these names
   into CMU forms, the case rests only on reversed-name search and field-specific
   filtering, which may not justify the work. This is the question the proposal
   rests on.
2. **Does anyone actually want surname sort?** Thai lists conventionally sort by
   given name. If no, Phase 2 shrinks to export columns and search.
3. **Confirmed but wrong later.** If a student confirms a split and later needs to
   correct it, does re-confirmation just overwrite `name_confirmed_at`? Proposed:
   yes, last write wins, no history kept.
4. **Thai collation for any future sort.** Postgres orders by the database
   collation, and the Docker image default will not give Thai dictionary order.
   Check `SELECT collname FROM pg_collation WHERE collname LIKE 'th%'`. Options
   are client-side `localeCompare("th")` (already used at
   `src/app/admin/students/page.tsx:355`) or an explicit `COLLATE` if ICU is
   present. Pre-existing, but a surname-sort feature makes it user-visible.
5. **Should the admin review screen be audit-logged?** It displays names in bulk
   next to suggested splits. Names are already visible in that directory, so this
   arguably adds no new exposure, but the bulk confirm action is a write and
   every other bulk identity path here is logged.

---

## 10. Findability is not affected

A concern raised during review: "if the fields are null, we will not be able to
find students in the directory."

This is not the case. The search predicate at
`src/app/admin/students/page.tsx:427-430` matches `prefix + name`, `studentId`,
and `nickname`. `name` is `notNull` and populated for 100% of users, including
everyone who never confirms a split. Phase 1 does not edit that predicate, so
search behaviour is unchanged.

A student becomes unfindable only if someone *removes* the `name` match and
searches the new fields alone. That must never happen, and it is the reason
`name` is retained. Any future search change (including the Phase 2 reversed-name
work) must keep `name` in the predicate as a fallback.

---

## 11. Security and PDPA impact

- No new authorisation is introduced. Split names appear only where the combined
  name is already authorised.
- Medical and export access gates, and audit logging, are unchanged (but see
  §9 Q5 on the review screen).
- Names must not be inferred into `given_name` / `family_name` from email
  addresses or Google account display names. Note that `users.name` itself
  **already** receives the Google display name at account creation via the
  DrizzleAdapter, before onboarding runs; that is existing behaviour and is not
  changed here. The rule applies to the two new fields only.
- CSV values continue through the existing formula-injection-safe `csvCell()`
  helper (`src/lib/csv.ts`).

---

## 12. Revision 2 changelog

Six points from the second review, and what changed:

| Point | Resolution |
|---|---|
| Guessed names must not reach official exports | **Accepted.** Suggestions are now UI-only (§5). Exports gate on `name_confirmed_at` and leave split columns blank for unconfirmed rows. The rev 1 claim that exports would be "populated on day one" is withdrawn |
| `compose()` requiring both names conflicts with mononym support | **Accepted.** The guard now keys on a confirmed given name; a confirmed mononym composes to the given name alone (§6) |
| §4 promised populated exports while §7 deferred them | **Accepted.** Same root cause as the first point; the contradiction is gone now that exports carry only confirmed data |
| The "12 export surfaces" count was inflated | **Accepted and verified.** Corrected to 7, with the miscounted entries listed explicitly (§7) |
| "Search does not benefit" was too absolute | **Partly accepted.** Substring findability genuinely does not improve, and §3 still says so. But reversed-name queries and field-specific filtering are real capabilities that only split fields allow, and §3 now credits them |
| XLSX can be unit-tested via extracted pure helpers | **Accepted.** §8 now requires the row mapping to be extracted and unit-tested, rather than treating all export behaviour as manual-only |

Both "high" findings traced to one missing piece: rev 1 had no way to
distinguish a confirmed mononym from an unconfirmed record, since both are
`family_name IS NULL`. The `name_confirmed_at` column added in §4 resolves both.

---

Next step: settle §9, then implement Phase 1 via `drizzle-migration-author` →
`/db-local` rehearsal → `/recheck` → `/safe-deploy`.
