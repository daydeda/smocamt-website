# Feature Spec — Anonymous Feedback & Complaints (ระบบรับความคิดเห็นและข้อร้องเรียนแบบไม่ระบุตัวตน)

> **STATUS: DRAFT — DECISION PENDING. NOT YET IMPLEMENTED.**
> Planning doc only — no schema, routes, or UI exist yet. Written jointly as
> BA / architecture / UX-HCI spec so a builder (human or agent) can go straight
> to a `drizzle-migration-author` + `new-admin-route` pass once the open
> decisions in §8 are signed off.

---

## 1. Context / บริบท

Students currently have exactly one structured way to push back on something:
[`no_show_appeals`](../../src/db/schema.ts) (`/admin/appeals`), and that's scoped
tightly to "I was marked absent, here's why." There's no channel for anything else —
event organization complaints, staff conduct, harassment, shop/order problems, bug
reports, or plain suggestions. The two requirements driving this spec:

1. **Admin-side triage must be fast.** A wall of undifferentiated free text is
   useless to staff — it needs a **type/category taxonomy** so it can be
   filtered, routed, and prioritized like a support queue.
2. **Submissions must be anonymous.** Decided in scoping (§2): logged in (so
   abuse control has a hook), but identity is **structurally withheld from every
   admin role, including super_admin** — not just masked in the UI.

This is a genuinely new pattern for the codebase: every existing "hide identity"
mechanism (`forms.showRespondentIdentity`, the club/major president medical-detail
carve-out) is a *view-level mask on top of a raw FK* — a `super_admin` can always
see through it (CLAUDE.md, Access control section). Feedback & Complaints inverts
that: the identity link should not be *reconstructable* through the app at all,
not just hidden by a role check. §5 spells out how.

**Explicitly out of scope / not duplicated:** no-show strike disputes stay in
`no_show_appeals`. The category picker (§4) should hint a student toward Appeals
if they pick something strike-shaped, rather than silently forking the same
complaint into two systems.

---

## 2. Scoping decisions (already made)

| Decision | Answer | Why it matters |
|---|---|---|
| Who can submit | Must be logged in (any ActiveCAMT account) | See caveat below — this is *not* currently a CMU-verification gate |
| Identity visibility | Withheld from **every** admin role, including super_admin — no in-app unmask feature | Stronger than the existing `showRespondentIdentity` pattern; see §5 |
| Follow-up | One-time **tracking code**, shown once at submission, never re-derivable if lost | Lets a submitter check status/reply without any account link |
| Category taxonomy | Proposed by this doc (§4), for review | Grounded in ActiveCAMT's actual domains, not generic |

**Important caveat carried over from scoping:** Google OAuth is not yet actually
restricted to `@cmu.ac.th` (pending CMU IT — see CLAUDE.md deploy notes elsewhere);
right now *any* email can register an ActiveCAMT account. So "must be logged in"
today buys **account-level rate limiting**, not CMU-affiliation verification. Once
CMU IT enables the domain restriction, this feature's abuse-resistance improves
automatically with zero code change — worth noting in the spec so nobody
over-trusts "logged in" as a legitimacy signal before that lands.

---

## 3. Personas & core user stories

- **Student reporter (any severity).** "I want to flag something without it
  being traceable to me, get proof I actually submitted it, and optionally find
  out what happened — without having to trust a promise, only a mechanism."
- **Student reporter, harassment/safety case specifically.** Same as above plus:
  needs to *believe*, before typing anything, that this is safe — copy and flow
  have to earn that in the moment, not just be technically true (see §7).
- **Admin triaging (super_admin/admin).** "I want to scan a queue, filter by
  type and urgency, and act — without ever needing (or being able) to know who
  sent it."
- **Admin replying.** "I want to close the loop with the reporter without an
  email address or account to message."

---

## 4. Feedback/complaint taxonomy (proposed — for review)

Capped at 7 + "Other" (choice-overload — Miller's law; more than ~7 peer options
measurably slows category selection and pushes people toward whichever is listed
first). Each carries a default severity that **only admins can downgrade**
(never auto-downgraded by the form, and downgrading gets audit-logged):

| Category (EN) | หมวดหมู่ (TH) | Default severity | Notes |
|---|---|---|---|
| Event / Activity | การจัดกิจกรรม | Normal | Scheduling, on-the-day organization, event safety |
| Staff / Organizer conduct | พฤติกรรมเจ้าหน้าที่ | Normal | Behavior of organizer/registration/staff |
| Harassment / Safety | การคุกคาม / ความปลอดภัย | **Urgent (locked)** | See §7 trauma-informed handling |
| House points / scoring dispute | ข้อโต้แย้งคะแนนบ้าน | Normal | **Not** for no-show strikes — inline hint routes those to Appeals |
| Shop / Order issue | ปัญหาร้านค้า/การสั่งซื้อ | Normal | Payment, delivery, product |
| Technical / Bug report | ปัญหาการใช้งานระบบ | Low | App broken, not working as expected |
| Facility / Venue | สถานที่/สิ่งอำนวยความสะดวก | Low | Physical space, equipment |
| Other / Suggestion | อื่นๆ / ข้อเสนอแนะ | Low | Catch-all, deliberately includes *positive* suggestions too |

The page name "Feedback **&** Complaints" should stay visually dual-framed
(e.g. 💡 vs 🚩 iconography) — a complaints-only framing measurably suppresses
people from submitting mild feedback/suggestions (they self-censor as "not
serious enough"), which is exactly the signal you'd also want to collect.

---

## 5. Anonymity architecture (the core design decision)

**Recommended: keyed-hash reference, not a raw FK.**

```
feedback_complaints
  id                  uuid PK
  tracking_code_hash  text NOT NULL UNIQUE   -- sha256(code); plaintext code is
                                              -- shown ONCE at submit and never
                                              -- stored — same principle as a
                                              -- password-reset token
  category            text NOT NULL          -- §4 enum, validated in Zod
  severity            text NOT NULL DEFAULT 'normal'   -- 'low'|'normal'|'urgent'
  message             text NOT NULL
  contact_opt_in      boolean NOT NULL DEFAULT false
  contact_info        text                   -- only if contact_opt_in; see §7
  attachment_keys     jsonb NOT NULL DEFAULT '[]'  -- private-bucket storage
                                              -- keys, reuse form-file-storage.ts
  submitter_ref       text NOT NULL          -- HMAC-SHA256(userId, FEEDBACK_HMAC_SECRET)
                                              -- NOT a users FK. Equality-comparable
                                              -- for abuse-control queries
                                              -- ("has this account submitted 10
                                              -- times today") but not reversible
                                              -- to a userId without the secret.
                                              -- NEVER selected in any admin-facing
                                              -- query/response — enforce via a
                                              -- narrow column allowlist, not by
                                              -- convention alone.
  status               text NOT NULL DEFAULT 'new'  -- 'new'|'in_review'|'resolved'|'closed'
  admin_reply          text
  replied_by           text                  -- admin's own userId, no FK (mirrors
                                              -- noShowAppeals.reviewedBy) — this
                                              -- identifies STAFF, not the reporter,
                                              -- so it's fine to store plainly
  replied_at           timestamptz
  created_at           timestamptz DEFAULT now()
  updated_at           timestamptz DEFAULT now()

indexes: unique(tracking_code_hash), index(status), index(category), index(severity)
```

Why HMAC over a raw FK: with a raw `studentId` (the `formSubmissions` pattern),
anonymity is one `SELECT *` mistake away from leaking, and is explicitly
role-gated rather than architecturally absent — exactly what §2 says isn't
strong enough here. An HMAC keyed by a server-only secret gives you the *same*
abuse-control query power (`WHERE submitter_ref = HMAC(currentUserId)`) with no
reverse path through the app, and — deliberately — no reverse path for a human
with DB access either, unless they also have the secret. That is a real,
intentional tradeoff: **there is no admin break-glass unmask feature in this
design.** If a genuine emergency ever needs de-anonymization (credible
imminent-harm threat), that has to be a manual, off-app, legally-reviewed
process — not a button in `/admin/feedback`. Flag this explicitly to whoever
signs off (§8) — it's a real limitation, not an oversight.

**Tracking code mechanics** (mirrors `calendarFeedTokens`'s revocable-secret
pattern, but one-shot instead of regenerable):
- Generate with `crypto.randomBytes`, render as an unambiguous alphabet (no
  `0/O`, `1/I`) at ~10 chars → comparable entropy to a UUID segment, low enough
  to type by hand, high enough that brute-forcing `/feedback/track` is
  impractical *combined with* IP rate-limiting on that endpoint (reuse
  `rate-limit.ts`) — the length alone is not the safeguard, the pairing is.
  Without rate-limiting, a bare 10-char code is still guessable at scale; this
  route needs its own explicit limit like `rateLimit(ip, 20, 60_000)`, not
  the default.
- Store only `sha256(code)`. Lookup hashes the incoming code and compares —
  timing-safe compare recommended even though this isn't a password (defense
  in depth is cheap here).
- Confirmation screen shows the code **once**, with an explicit "we cannot
  recover this for you, and we cannot look it up on your behalf, because we
  don't know who you are either" — see §7 for why that phrasing matters more
  than it looks.

### 5.1 Notification hook (SMTP)

`src/lib/feedback-notify.ts` exposes two calls — `notifyNewComplaint(complaint)`
and `notifyComplaintResolved(complaint)` — each building a plain-text/HTML
summary (category, severity, message, tracking-code-hash-derived short id for
cross-reference, **never** the raw tracking code or any submitter reference)
and sending it via `nodemailer` SMTP to `smocamt.official@camt.info`. Both are
called from the service layer (§6), not the route handler, and are
**fail-open**: an SMTP error is logged (`src/lib/logger.ts`) but never blocks
or fails the submission/resolve request — same fail-open principle the
project already applies to `rate-limit.ts`, since a notification channel must
never become a reason a complaint fails to save. Kept as two narrow functions
specifically so swapping SMTP for a PWA push send later is a one-file change.

**Audit logging still applies — to staff actions, not reporter identity.**
Every status change / reply writes to `audit_logs` (actor = admin's userId,
target = complaint id, action = `feedback_status_change` / `feedback_replied`).
This gives accountability for what staff *did*, without ever touching who
reported it — consistent with the project's "every admin access to sensitive
data gets an audit log" rule, just applied to the staff side instead of a
read-access side, since there is no read-access to gate here.

---

## 6. Access control (mapped to the 4-layer gate)

- **`src/proxy.ts`** — the landmine layer (CLAUDE.md calls out a 5-PR loop from
  missing this). Two new pages need explicit handling:
  - `/feedback/new` — submission page. **No proxy change needed**: it's not in
    `isPublicPath`, so the existing default (redirect-to-login if no session)
    already enforces "must be logged in" correctly.
  - `/feedback/track` — public lookup page, **no login**. **Must be added to
    `isPublicPath`** or it 404s/redirects for the exact people who need it
    (someone with only a code, deliberately not logged in to check it).
  - API routes need **no proxy change at all** — the matcher excludes all
    `/api/*` already (same reason `/api/calendar/feed/[token]` needs none):
    `GET /api/feedback/track/[code]` is public-by-design at the route level.
- **`admin-access.ts`** — add `/admin/feedback` to entry roles. Recommend
  **super_admin/admin only** in v1, deliberately *not* extending to
  registration/organizer/smo/president roles the way most admin areas do:
  those roles can themselves be the *subject* of a Staff Conduct or Harassment
  complaint, so widening visibility here directly undermines §5's guarantee in
  a way it doesn't for, say, the shop or event modules. Revisit only per
  category if there's a real triage-load reason to (§8).
- **API routes** (`new-admin-route` skill pattern): `POST /api/feedback`
  (authenticated, not admin-gated), `GET /api/feedback/track/[code]` (public),
  `GET/PATCH /api/admin/feedback[...]` (super_admin/admin gate + Zod + audit
  log transaction, per the skill's standard scaffold).

---

## 7. UX / HCI design

### 7.1 Submission flow
1. **Category picker** — cards, not a dropdown (recognition over recall):
   icon + one-line label + one-line example per §4. Harassment/Safety card
   visually distinct but not alarming (avoid red/siren treatment that itself
   discourages disclosure — softer, serious-but-safe tone) and carries a
   secondary line: *"If you're in immediate danger, contact [CMU emergency/
   counseling contact — TBD, see §8] first."* This needs a real contact from
   CMU/CAMT staff before ship; don't ship a placeholder.
2. **Message + optional attachment** (reuse `form-file-storage.ts`'s
   private-bucket pattern, 5MB cap per CLAUDE.md) **+ optional "want a reply?"
   contact opt-in.** This is a distinct, explicit, opt-in disclosure — the
   reporter *chooses* to type a Line ID/email into a free-text field for
   follow-up purposes. That's categorically different from the account
   identity being withheld in §5: it's voluntary and purpose-limited, not
   something the system infers. Keep the two concepts visually separate in the
   UI so a reporter never confuses "the system doesn't know who I am" with "I
   just told them how to reach me."
3. **Review-before-send screen** — because there's no "edit my last message"
   once it's anonymous and sent; catch typos/regret here, not after.
4. **Confirmation screen** — tracking code, copy-to-clipboard, explicit
   "save this now" warning phrased precisely (see below), optional
   client-side-only "email this code to yourself" via a `mailto:` link
   (never touches the server, so it can't compromise the anonymity model).

### 7.2 Calibrated trust copy (do this precisely, not vaguely)
Don't ship generic "100% anonymous" marketing language — it overpromises and,
if a reporter later reasons about it (or asks a technical friend), an
overprecise claim that turns out imprecise damages trust worse than a modest
accurate one. Say what's actually true per §5: *"Your account is not shown to
anyone reviewing this — not even senior admins. What they see is your message,
category, and any attachment. There's no button in the system that lets anyone
look up who sent this."* That's both accurate and reassuring, which is the
actual goal.

### 7.3 Admin triage view (`/admin/feedback`)
- List/queue with filters: category, status, severity — sortable, severity
  shown as icon+text badge (never color-only, for colorblind accessibility).
- No "submitter" column or field anywhere in the UI — not even an "Anonymous"
  placeholder; the concept doesn't exist in this view, by design.
- Detail drawer: message, category, severity (admin can downgrade, logged),
  attachments, status dropdown, reply composer.
- **Every new submission (not just `urgent`) emails `smocamt.official@camt.info`**,
  and a second email fires when an admin resolves/replies — both **decided**
  (2026-08-13), no longer open. This is the interim out-of-band alert channel
  until the app becomes a PWA with push notifications (planned, not yet
  built); swap the notify call for a push send later without touching the
  submission/resolve logic itself, since it's a single hook point (§5.1 below).
  Also still badge super_admin/admin in-app (`useNotifications.ts` /
  `NotificationToasts.tsx`) as a secondary signal.
- Both emails go to the **shared staff inbox only**, never to the submitter —
  consistent with §5's anonymity guarantee (the app has no submitter email to
  send to in the first place, short of the opt-in `contact_info` field, which
  stays a v2 feature).

### 7.4 Accessibility
Keyboard-navigable category cards, ARIA labels, `aria-live` on validation
errors, severity never color-only, i18n across all 4 languages (EN/TH/MM/CN)
per project convention — route new strings through `i18n-completeness` once
copy is finalized rather than hardcoding.

---

## 8. Open decisions before build

- [ ] **Real CMU safety/counseling contact** for the harassment-category
      safety line (§7.1) — needs an actual name/number from CAMT staff, not a
      placeholder.
- [x] **Out-of-band alerting** — **decided (2026-08-13)**: email
      `smocamt.official@camt.info` via SMTP (nodemailer, app-password auth on
      that mailbox — no Google Admin console access needed) on every new
      submission and again on admin resolve/reply. Chosen over a third-party
      transactional-email provider (e.g. Resend) specifically to avoid adding
      a new external processor to a PDPA-sensitive app that already went
      self-hosted to minimize third parties (CLAUDE.md deploy notes), and
      because the mailbox already exists — no new vendor signup. Interim
      until the planned PWA push-notification path exists.
- [ ] **Retention policy** — how long do resolved/closed complaints live?
      PDPA data-minimization argues for a purge/archive window even though the
      records are already de-identified (the `message` body itself could still
      contain identifying details the reporter typed in).
- [ ] **New env vars needed before deploy** (not code-blocking — the app
      should run with these unset in dev, just skip sending/logging a warning):
      `FEEDBACK_HMAC_SECRET` (new dedicated secret, don't reuse
      `NEXTAUTH_SECRET` — separate rotation/blast-radius concerns) and
      `FEEDBACK_SMTP_USER` / `FEEDBACK_SMTP_PASS` (the `smocamt.official@camt.info`
      app password — requires 2-Step Verification enabled on that mailbox
      first, doable with account access alone, no Workspace admin needed,
      *unless* the org has disabled app passwords by policy, in which case an
      admin has to allow it). Land these in `.env.local` for local testing and
      the Portainer container env for prod, per `/safe-deploy`.
- [ ] **Break-glass acknowledgment** — confirm the team is deliberately
      accepting "no in-app unmask, ever" (§5) as policy, not just an
      implementation gap to fill in later.
- [ ] **House-points category ↔ Appeals overlap** — confirm the inline-hint
      approach (§1/§4) is enough, or whether that category should be removed
      entirely in favor of a link to `/admin/appeals`'s existing flow.
- [ ] **Category taxonomy sign-off** (§4) — adjust/rename/merge before it's
      built into the schema as an enum-ish `text` column.

## 9. Phasing

**MVP:** submit + categorize + tracking code + admin triage list + single
reply + in-app urgent notification.
**V2 (not blocking MVP):** threaded follow-up via tracking code (submitter can
reply again, not just read), category-trend analytics for staff (which
categories spike around which events — useful signal, zero re-identification
risk since it's aggregate), out-of-band urgent alerting if not done in v1.
