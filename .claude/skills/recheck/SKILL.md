---
name: recheck
description: Comprehensive multi-dimension review of the current diff for ActiveCAMT (Next.js + Supabase + Vercel) — checks correctness/bugs, security & access control, PDPA/medical data exposure, performance, and refactor/simplification in one pass, ranking every finding as crucial / moderate / low and flagging quick wins. Use before opening a PR, before deploying, or any time the user asks to "re-check", "review everything", or "look it over" for quality. Reviews only the current diff vs the base branch by default.
---

# Recheck (ActiveCAMT full-diff review)

One pass that re-checks the current diff across every dimension that has bitten this
project before: **bugs, security/access-control, PDPA & medical-data exposure,
performance, and refactor/cleanup.** Default scope is the current diff vs the base
branch — focused, PR-ready. Report findings; only edit when the user asks.

## When to run
- Before opening a PR or deploying (pairs with [[safe-deploy]] for schema changes).
- Whenever the user says "re-check", "review everything", "anything wrong with this?",
  or wants a quality gate before shipping.

## Step 1 — Establish the diff

```bash
git rev-parse --abbrev-ref HEAD          # current branch (should NOT be main)
git fetch origin main --quiet 2>/dev/null || true
git diff --stat $(git merge-base origin/main HEAD 2>/dev/null || echo main)...HEAD
git diff $(git merge-base origin/main HEAD 2>/dev/null || echo main)...HEAD
```

If there are uncommitted changes, also review `git diff` and `git diff --staged`.
Read the full diff before forming findings — never review from filenames alone.
For any changed file where the surrounding context matters (a function you can only
see half of), open the file and read enough around the hunk to judge it correctly.

## Step 2 — Review across all dimensions

Go through every dimension. For each finding, note **file:line**, the **dimension**
(bug / security / perf / refactor), a **severity tier**, and a concrete fix. If a
dimension is clean, say so explicitly — silence is not the same as "checked and fine".

**Severity tiers** (assign exactly one per finding):
- **🔴 Crucial** — must fix before merge. Will break prod, corrupt/lose data, expose
  a security hole, or leak PDPA/medical data. Anything that, if shipped, causes an
  incident.
- **🟠 Moderate** — should fix. A real bug, missing authz on a low-traffic path, an
  N+1 on a growing table, or a correctness gap with a workaround. Not catastrophic,
  but wrong.
- **🟡 Low** — minor. Edge case unlikely in practice, small inefficiency, style/type
  tightening, dead code. Safe to defer.
- **⚡ Quick win** — a *cross-cut tag*, not a fourth severity: flag any finding whose
  fix is small/low-risk (≈ a few lines, no design change) **and** clearly worth it.
  A finding can be both Crucial **and** a Quick win — tag it `🔴 ⚡`. Surface these
  prominently so the user can knock them out immediately.

Apply the tiers to bugs, security, AND performance findings alike — a slow query and
an auth gap both get a tier.

### 1. Correctness & bugs
- Logic errors, off-by-one, wrong conditionals, inverted boolean checks.
- Unhandled promise rejections, missing `await`, race conditions.
- Null/undefined access, unsafe non-null assertions, empty-array/edge cases.
- Error paths: are thrown errors caught and surfaced, or swallowed?
- Does the change actually do what its commit/PR message claims?

### 2. Security & access control  ⚠️ highest-risk area in this repo
- **`src/proxy.ts` middleware runs FIRST** and is easy to forget. Access is gated in
  **4 layers** — if this change touches auth, roles, or a protected route, verify the
  rule holds at *every* layer, not just the one in the diff. (This caused the
  SMO-scanner 5-PR loop — see [[project_admin_access_layers]].)
- Authz on every new/changed API route and server action: is the caller's role
  actually checked server-side, not just hidden in the UI?
- IDOR: can a user pass someone else's id and read/write rows they shouldn't?
- Input validation on anything from the request (body, query, params).
- Secrets: no keys/tokens in client bundles, logs, or committed env.
- SQL/Drizzle: parameterized only — no string-interpolated user input.
- **Auth domain gate (`src/auth.ts` `signIn`)**: the callback comment claims a
  university-domain restriction (FE-01), but a stray `return true` silently lets any
  Google account in. Verify the code actually `return false`s non-allowed domains —
  don't trust the comment. (Also watch `allowDangerousEmailAccountLinking`.)

### 3. PDPA & medical-data exposure  ⚠️ this is a regulated, PDPA-sensitive app
- **Medical: registration sees the SIGNAL (who has a condition), never the DETAIL.**
  Detail + `medsCheckOption` is **admin-only**. Verify the diff never leaks medical
  detail to a non-admin surface (API response, log, client prop, CSV export).
  See [[project_attendance_medical_access]].
- **Two medical paths — check BOTH.** The *attendance* endpoint sanitizes medical to
  categories for non-super_admin/admin, but the *scanner service*
  (`src/modules/events/scanner.service.ts` `processScan`) builds a `studentWithMedical`
  payload that `/api/admin/scan` returns to `registration`/`organizer`/`smo`. The UI
  only shows labels, but the raw free-text is in the JSON (DevTools-readable). The desk
  needs only `hasMedicalCondition`; confirm the detail fields are stripped for
  non-super_admin/admin on the **scan path**, not just attendance.
- Emergency contacts: visible to admin roles only.
- No PII (names, student ids, phone, medical) in `console.log`, error messages, or
  analytics that ship to the client or third parties.
- Any new field added to a user-facing payload: confirm it's meant to be exposed.

### 4. Performance
- N+1 queries — loops issuing one DB call per item; batch with `inArray`/joins.
- Queries inside React render or per-request hot paths that should be cached/memoized.
- Missing `await` parallelization (`Promise.all`) where calls are independent.
- Large client bundles: heavy imports pulled into client components; prefer server
  components / dynamic import. Next.js `sin1` region — avoid chatty round-trips.
- Unbounded queries (no `limit`) on tables that grow (activity feed, attendance).
- **Polled endpoints must be O(1), not O(table).** Never `with: { attendances: true }`
  + `.length` to get a count on a polled endpoint — use a `COUNT(*) GROUP BY` aggregate.
  A polled query over a table that grows *during* the event (`/api/admin/events` did
  this every 8 s) is the classic pooler-starvation 504 trigger here. Also don't run
  `checkAndAward*()` on a hot read path — they run via `/api/admin/award-check` + cron.

### 4b. Free-tier capacity (Supabase free + Vercel Hobby, ~400–500 concurrent / event)
- **Sessions must stay JWT** (`strategy:"jwt"` in `src/auth.ts`) so `auth()` does no
  per-request DB hit; the periodic DB refresh must live in the `jwt` callback (persists
  to the cookie) so it fires at most once per interval, not every request.
- **Pool stays `max:5`** over the transaction pooler (`:6543`, `prepare:false`).
- **Student-facing polls stay ≥60 s** with a low, bounded per-tick query count; prefer
  cacheable (`s-maxage`) responses for data shared across users.
- `src/lib/util/rate-limit.ts` is **per-instance in-memory** — not a global limit on Vercel.
- Vercel Hobby has **no overage — it PAUSES at limits**; recommend Pro for a critical
  one-shot event. The binding Supabase risk is connection-holding by a slow/growing
  query, not raw query volume.

### 5. Refactor, simplification & reuse
- Duplicated logic that an existing helper already covers — search before flagging.
- Dead code, unused vars/imports, commented-out blocks left in the diff.
- Over-complex conditionals that simplify; values that should be named constants.
- Naming/idiom consistency with surrounding code.
- Tighter types — replace `any`, narrow where the data shape is known.

### 6. Tests & build hygiene (quick check)
- Does new logic have/ need a test? Did the change break an existing one?
- Run lint/build when the diff is non-trivial:
  ```bash
  npm run lint
  npm run build      # catches type/route errors before Vercel does
  ```

## Step 3 — Report

Group findings by severity tier, most serious first. Tag the dimension on each line
(`[bug]` / `[security]` / `[perf]` / `[refactor]`) and append `⚡` to quick wins.
Lead with a one-line scoreboard so the user sees the shape at a glance.

```
## Recheck — <branch>
🔴 2 crucial   🟠 3 moderate   🟡 4 low   ⚡ 5 quick wins

### ⚡ Quick wins (small fix, do these now)
- src/db/queries.ts:88 — 🟠 [perf] N+1: one query per attendee. Batch with inArray(). (~3 lines)
- src/lib/log.ts:20 — 🔴 [security] studentId logged to console; drop the field. (1 line)

### 🔴 Crucial (must fix before merge)
- src/app/api/.../route.ts:42 — [security] No server-side role check; any logged-in
  user can hit this. proxy.ts doesn't cover it either. Fix: gate with <helper>.
- src/app/api/.../route.ts:61 — [bug] medical detail returned in payload to a
  non-admin caller — PDPA leak. Fix: strip to signal unless isAdmin.

### 🟠 Moderate (should fix)
- src/db/queries.ts:120 — [perf] Unbounded attendance query, no limit. Page it.

### 🟡 Low (defer ok)
- src/components/X.tsx:12 — [refactor] Duplicates formatThaiDate(); reuse it.

### Clean
Correctness ✓  PDPA/medical ✓  Build ✓
```

(Quick wins are also listed under their own tier — the ⚡ section is a curated
shortlist, not a separate set of findings. Don't double-count them in the scoreboard:
the tier counts cover everything; `⚡` counts how many of those are quick wins.)

End with a one-line verdict: **ship**, **ship after crucials**, or **needs work**.

## Notes
- Default is **report-only**. Apply fixes only if the user asks (then keep edits
  minimal and matched to surrounding style).
- This skill does not deploy or migrate. For schema/deploy safety use [[safe-deploy]].
- For a deeper cloud multi-agent pass, the user can run `/code-review ultra`
  themselves — you cannot launch it.
