# Feature — Web push notifications

**Status: Phase 1 IMPLEMENTED** (`feat/pwa-support`, 2026-09-17), on top of the
PWA installability work (manifest + `public/sw.js` + icons) that makes push
reachable on iOS at all. One trigger below is **deliberately NOT implemented**
— see "Blocked: feedback-reply-to-submitter" — because building it would
require breaking the feedback system's own anonymity guarantee. Everything
else in the Phase 1 table is live.

### Done vs. left — quick checklist

**Done (code, on this branch):**
- [x] `push_subscriptions` table — schema.ts, `drizzle/0041_*.sql`, **and** the
  hand-written `migrate.ts` block (see "Implementation notes" — the generated
  SQL alone would NOT have reached prod on this project).
- [x] `PushService` (send/subscribe/unsubscribe/pruning), `push-audience.ts`
  (role/scope-aware audience resolution).
- [x] Service worker `push` / `notificationclick` / `pushsubscriptionchange`.
- [x] Subscribe/unsubscribe/vapid-key API routes.
- [x] Profile page permission toggle (iOS-aware), wired into all 3 sign-out
  call sites for shared-device cleanup.
- [x] 6 triggers wired: shop order decision, appeal decision, new appeal
  (scoped), new proposal, new shop order (scoped), new seller application,
  new feedback/reply → managers, announcement broadcast.
- [x] `npm test` (50 new tests), `npm run lint`, `npm run build`, migration
  rehearsed twice locally — all green.

**Left — things that still need a human to do, not more code:**
- [ ] **Generate a real VAPID key pair and set it in 2 places** (GitHub repo
  Variable + Portainer stack env vars) — see "Setting up your VAPID keys"
  below. Nothing sends until this is done; everything degrades quietly, not
  with an error, until then.
- [ ] Run the real migration in prod via `/safe-deploy`
  (`npm run db:migrate:container` from the Portainer console) **before**
  deploying this code.
- [ ] Manual `/verify` of an actual push receipt on a real device — this
  can't be done from an agent session (needs a real browser permission grant).
  Do this once after the keys are set, especially the iOS installed-PWA path.
- [ ] Decide the feedback-reply-to-submitter tradeoff (see "Blocked" section)
  — or leave it unimplemented, which is the current default.
- [ ] Phase 2 (form reminders, event-starts-tomorrow) is blocked on fixing the
  cron scheduler gap this design surfaced (see "Constraint 2" below) — separate
  work, not part of this PR.

## Setting up your VAPID keys

VAPID (Voluntary Application Server Identification) is how a push service
(Chrome's/Firefox's/Apple's backend) verifies that pushes claiming to be from
ActiveCAMT actually are — it's a signing key pair, not a per-user secret. You
generate it **once** for the whole app, not per deploy and not per user.

1. **Generate the pair** (do this once, keep the output somewhere safe):
   ```
   npx web-push generate-vapid-keys
   ```
   This prints a `Public Key` and a `Private Key`. Also decide a
   `VAPID_SUBJECT` — a `mailto:` contact address the push services can use to
   reach you if they need to (e.g. `mailto:smocamt.official@camt.info`).

2. **Where each value goes** — this splits across 2 systems because the
   public key has to be baked into the app at BUILD time (Next.js inlines
   `NEXT_PUBLIC_*` values into the JS bundle), while the private key is a
   runtime secret the container reads on startup:

   | Value | Where | Why |
   |---|---|---|
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | **GitHub → this repo → Settings → Secrets and variables → Actions → Variables tab** (NOT Secrets — it's meant to reach the browser) → New repository variable | Read at Docker **build** time by `.github/workflows/docker-publish.yml`, baked into the image. A Portainer env var can't reach this — it only affects the already-built image at runtime. |
   | `VAPID_PRIVATE_KEY` | **Portainer → the `activecamt-app` stack → Environment variables** | Read at container **runtime**. Never put this in a GitHub *Variable* (those aren't secret) — if GitHub secrets are available to you, a **Secret** would also work, but it isn't wired into the build args currently, only into `docker-stack.yml`'s runtime `environment:` — so Portainer is the actual place. |
   | `VAPID_SUBJECT` | Same as above — Portainer stack env vars | Also runtime-only, not build-time. |

3. **After setting the GitHub Variable**, the next push to `main` (i.e. the
   next merged PR) will build a fresh image with the public key baked in —
   you don't need to do anything else for that side.

4. **After setting the two Portainer env vars**, redeploy/restart the
   `activecamt-app` stack so the container picks them up (Portainer doesn't
   hot-reload env var changes into a running container).

5. **Rotating the keys later invalidates every existing subscription** — every
   student who'd enabled push would silently stop receiving it until they
   revisit the profile toggle and re-enable. Treat this pair as long-lived;
   don't regenerate it casually.

6. For **local development**, a throwaway test pair is already sitting in
   your `.env.local` (gitignored, never committed) — you don't need to do
   anything for local testing to work; just don't reuse those exact values in
   production.

## Problem

The app already has "notifications", but they are **derived and polled, not
pushed**: `src/app/api/notifications/route.ts` computes them live on every
request from `attendance`, `audit_logs` and `forms`/`form_submissions`, with a
5-minute `MAX_LOOKBACK_MS` ceiling and a 90-second cold start. There is no
notifications table — a notification is a *query result*, not a row.

That design is fine for what it does (a toast while the student is looking at
their Digital ID) but it structurally cannot reach a student whose app is
closed, which is where the actual product need is: students forget to fill a
K_pre/K_post form, forget an event they registered for, and don't know when a
shop order was approved. `FormsDueBanner` exists precisely because this
forgetting is a real problem, and it only works if they open the app.

So: keep the polled in-app notifications as they are, and add a genuinely
separate push channel alongside them.

## Feasibility — yes, with two hard constraints

| | Status |
|---|---|
| Android Chrome / Firefox, desktop Chrome / Edge / Firefox | Works, no restrictions. Install not required. |
| **iOS Safari** | Works **only** for a PWA the user added to the home screen (iOS 16.4+). `Notification.requestPermission()` from a normal Safari tab fails silently. |
| HTTPS origin | Already satisfied (`activecamt.camt.cmu.ac.th`). |
| Permission | **Always** an explicit native OS prompt. Installing the PWA grants nothing. There is no way to pre-grant or skip it. |

**Constraint 1 — permission is per-device and revocable.** A hard "Don't
Allow" on iOS cannot be re-prompted; the user has to go into Settings. So the
prompt must never be spent cheaply (see "Permission UX" below).

**Constraint 2 — there is no scheduler on the self-hosted deploy.** The two
cron jobs are declared in `vercel.json`, which does nothing now that the app
runs on Docker/Portainer. `docker-stack.yml` passes `CRON_SECRET` but nothing
calls `/api/cron/*`. **This means `checkAndAwardPastEventPoints` and
`checkAndAwardClosedForms` are very likely not running in production today** —
a pre-existing bug this design surfaced, worth confirming independently of
push. Any *time-based* push (form reminders, "event starts tomorrow") is
blocked on fixing it; *write-path* pushes are not.

## Model

### Storage — `push_subscriptions`

A push target is a browser subscription, not a user session, so it needs a row.

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `user_id` | → `users.id`, **on delete cascade** |
| `endpoint` | text, **UNIQUE globally** — see below |
| `p256dh`, `auth` | text, the subscription's encryption keys |
| `user_agent` | nullable, so a future "your devices" UI can label rows |
| `created_at`, `last_success_at`, `failure_count` | hygiene / pruning |

`endpoint` is unique **globally, not per user**, and that is deliberate. A
browser has one subscription per VAPID key, so on a shared lab machine the
*same* endpoint will be re-offered under a different account. Upserting on
`endpoint` and overwriting `user_id` transfers the device to whoever subscribed
last; a per-user unique key would instead leave a stale row and send student
A's notifications to student B's screen.

### Shared-device hygiene (PDPA-relevant)

Same reason, second half: **the subscription row must be deleted on sign-out**,
and the client should call `pushManager.unsubscribe()`. Otherwise a student who
logs out of a faculty machine keeps receiving their own notifications on it
indefinitely. Hook the NextAuth `signOut` event server-side; don't rely on the
client alone, since it may never run.

### Sending

- `web-push` (npm) for VAPID signing + payload encryption. Node runtime only —
  must never be imported into `src/proxy.ts` (edge).
- Keys: `VAPID_PRIVATE_KEY` (secret), `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (public by
  design, must reach the browser), `VAPID_SUBJECT` (`mailto:`). Generated once
  via `npx web-push generate-vapid-keys`. **Rotating them invalidates every
  existing subscription**, so treat them as long-lived. Add to
  `docker-stack.yml` + `.env.production.example`.
- **Never block a write path on a send.** The scanner is a hot path — staff
  scanning a queue — and a send is an HTTPS round-trip to FCM/Apple. Use
  `after()` from `next/server` so it runs once the response is already
  flushed. No outbox table, no queue infra.
- Bulk sends (anything fan-out) need a concurrency cap (~20) rather than
  `Promise.all` over every student.
- **Prune on failure:** `404`/`410` from the push service means the
  subscription is dead → delete the row. Anything else → bump `failure_count`,
  drop the row past a threshold. Also handle `pushsubscriptionchange` in the
  service worker as best-effort re-subscribe.

### Service worker

`public/sw.js` gains `push` and `notificationclick` handlers. This does **not**
compromise its no-caching stance — the file's existing comment explains why it
deliberately caches nothing, and push adds no cache.

- `push` → always call `showNotification`, even on an empty/garbage payload.
  Chrome punishes a push that shows nothing with its own generic "This site has
  been updated in the background" notification.
- Use `tag` to collapse repeats, `data.url` to carry the deep link.
- `notificationclick` → `clients.matchAll()`, focus an existing tab and
  navigate it if one exists, else `clients.openWindow(url)`.

### Payload content policy (PDPA)

Payloads are end-to-end encrypted — Google/Apple/Mozilla relay ciphertext and
cannot read them. But **the notification renders on a lock screen**, visible to
anyone holding the phone, so content is gated tighter than the app itself:

- Only ever about the recipient's **own** activity.
- **Never** medical signal or detail, never another student's name or PII,
  never anything from the appeals/feedback bodies beyond "you have a reply".
- Metadata (that a push happened, to which endpoint, when) *is* visible to the
  push service as a third-party processor, even though content is not. Content
  carries no personal data off-platform; that asymmetry should be stated if
  this ever goes in the PDPA register.

### Where the code goes

Per `CLAUDE.md`, domain logic belongs in a module, not a route handler:

- `src/modules/notifications/push.service.ts` — subscribe/unsubscribe, send,
  fan-out, pruning. (Deliberately *not* `src/lib/`; the shop/battle placement
  is called out in `CLAUDE.md` as an inconsistency not to copy.)
- `src/lib/push-payload.ts` + `push-errors.ts` — pure helpers: payload builder,
  dedupe-key builder, "which HTTP status means delete vs retry", the
  iOS-standalone capability predicate. These are the testable surface.
- `src/app/api/notifications/push/subscribe|unsubscribe/route.ts`.

## Triggers — pick a Phase 1 set

Ranked by whether the app is plausibly *closed* when it fires (which is the
entire point) against effort:

| Trigger | App closed? | Needs cron? | Value |
|---|---|---|---|
| Shop order approved / rejected | Yes | No | High — the buyer is waiting on a human decision |
| Feedback/complaint reply | Yes | No | High — currently discoverable only by revisiting |
| No-show appeal decision | Yes | No | Medium |
| Outstanding form reminder | Yes | **Yes** | **Highest** — this is `FormsDueBanner`'s whole reason to exist |
| Event starts tomorrow | Yes | **Yes** | High for attendance |
| House points awarded | Sometimes | Bulk path is cron | Medium — engagement, not action |
| **Check-in confirmed** | **No** | No | **Low — recommend skipping.** The student is standing at the scanner with the app open; they already get the in-app toast. Pushing would double-notify. |

**Recommended Phase 1:** the three write-path rows (order decision, feedback
reply, appeal decision). They need no scheduler, are low-volume, are easy to
verify by hand via `/verify`, and prove the whole pipe end-to-end.

**Phase 2:** form reminders + event-starts-tomorrow — *after* a scheduler
exists. These need a dedupe table (`push_log`, unique `(user_id, dedupe_key)`,
insert-on-conflict-do-nothing, send only if the insert actually inserted),
otherwise a nightly job re-sends the same reminder on every run.

**Phase 3 (maybe):** per-category preferences. Phase 1 ships a single on/off —
the OS permission plus deleting the device row is a sufficient switch to start.

## Permission UX

Never call `requestPermission()` on page load. Browsers penalise it, and iOS
requires a user gesture.

- A real toggle in `/dashboard/profile`, and optionally a soft in-app
  pre-prompt elsewhere that explains the value *before* spending the native
  prompt. Native prompt only ever from a click handler.
- **iOS branch:** if iOS and not running standalone, do not call
  `requestPermission()` — it fails silently. Show "Add to Home Screen first"
  with instructions instead. Detect via `display-mode: standalone` /
  `navigator.standalone`.
- Handle denied state explicitly: show "blocked in your browser settings"
  rather than a toggle that silently does nothing.
- All four languages (EN/TH/MM/CN) per the `i18n-completeness` convention.

## Validation

- **Unit (`npm test`, pure logic only):** payload builder, dedupe keys,
  status→delete/retry classification, iOS-standalone predicate.
- **Manual (`/verify`):** the send path can't be unit-tested. Real device, real
  install, permission grant, background the app, trigger an order decision,
  confirm delivery + that the deep link focuses the right page. Repeat on iOS
  installed-PWA specifically, since it's the fragile one.
- `npm run lint` + `npm run build`.
- **Migration:** `db:generate`, idempotent and non-destructive, rehearsed
  locally (`/db-local`), and **prod migrated before the code that reads it
  deploys** — `/safe-deploy`.

## Open questions

1. **Scheduler.** How should `/api/cron/*` actually run on the self-hosted
   deploy — host crontab hitting the URL with `CRON_SECRET`, or a sidecar
   (Ofelia) in the stack? This blocks Phase 2 and is probably a live bug today,
   independent of push.

~~2. Phase 1 trigger set~~ — resolved below.
~~3. Who else gets pushes~~ — resolved: staff, yes.
~~4. Announcements~~ — resolved: broadcast the existing singleton as-is, no new
message-feed concept needed (see below).

## Phase 1 — final scope (2026-09-17)

Decided: staff get pushed too, and an announcement publish broadcasts to
everyone. Audiences below were read directly off the **existing access-control
predicates** for each flow (via code research), not invented separately, so a
push audience can never diverge from who can actually see the item in the
admin UI.

`push.service.ts` only knows "send to this set of user IDs" — a new
`push-audience.ts` resolves *who* per trigger, reusing the exact role/scope
predicates already gating each admin surface.

### Student-facing

| Trigger | Hook | Audience | Status |
|---|---|---|---|
| Shop order approved/rejected | `PATCH /api/admin/shop/orders/[id]` | the buyer | **Implemented** |
| No-show appeal decision | `PATCH /api/admin/appeals/[id]` | the appealing student | **Implemented** |
| Staff reply on a feedback/complaint thread | `FeedbackService.postStaffMessage` | the submitter | **BLOCKED — see below, not implemented** |

### Staff-facing

| Trigger | Hook | Audience | Scoped? | Status |
|---|---|---|---|---|
| New event proposal submitted | `POST /api/admin/event-proposals` | `REVIEW_PROPOSAL_ROLES` (`super_admin, admin, registration, organizer`) + smo/anusmo holding the **global** `registration` position | **No** — deliberately global; club/major presidents are never reviewers here (existing comment in that file says so explicitly) | **Implemented** |
| New shop\_seller application | `POST /api/shop/seller` | `isShopAdmin` (`super_admin`/`admin`/SMO-finance) | No | **Implemented** |
| New complaint / new submitter message | `FeedbackService.createComplaint` / `postSubmitterMessage` | `isFeedbackManagerAny` (`super_admin`/`admin` only) | No | **Implemented** (added alongside the existing `feedback-notify.ts` email, not replacing it) |
| New no-show appeal submitted | `POST /api/appeals` | `VIEW_APPEALS_ROLES` globally for the unscoped roles, **narrowed to `EventScopeService`-matching president(s)** for `club_president`/`major_president` via the appeal's event `ownerClubIds`/`ownerMajors` | **Yes** | **Implemented** |
| New shop order placed | `POST /api/shop/orders` | `isShopAdmin` (unscoped, always) **plus** whichever president/seller owns the product(s) in that order | **Yes** | **Implemented** |

The two scoped rows needed real DB plumbing (club/major → president user-id
lookup), not just a role filter — `src/modules/notifications/push-audience.ts`
has `getClubPresidentUserIds`, `getMajorPresidentUserIds`,
`getEventOwnerPresidentUserIds`, and `getShopOrderAudienceUserIds` for this,
built on the same lookups `ClubsService`/`MajorsService` already use to answer
"who presides over X" elsewhere. All audience queries there scan the full
`users` table and filter in JS via `effectiveRoles()` rather than a jsonb SQL
predicate — see that file's header comment for why (no existing, verified
jsonb-role SQL pattern in this codebase; correctness over a marginal
optimization on a non-hot path).

### Blocked: feedback-reply-to-submitter (not implemented)

`FeedbackService.postStaffMessage` — staff replying on a complaint thread —
was in the original student-facing table above, but **implementing it would
require deanonymizing the submitter**, which conflicts with a core, explicit
design decision (§5 of `docs/features/feedback-complaints.md`).

The mechanism: `feedbackComplaints` stores only `submitterRef =
HMAC(FEEDBACK_HMAC_SECRET, userId)`, never a raw `userId` — deliberately, so
that even an admin with full DB access can't casually join a complaint back to
the student who filed it (the file's own header comment: "no query here
selects `submitterRef` into an admin-facing response, and no function accepts
a raw userId from anywhere other than the caller's own authenticated
session"). A push send is keyed by `push_subscriptions.userId`, so pushing
"the submitter" when staff replies would require either:

1. Reversing `submitterRef → userId` (looping over all users, HMAC-ing each,
   matching) at reply time — turning a de-anonymizing operation the codebase
   currently avoids as a matter of discipline into a routine, automated part
   of every staff reply, or
2. Storing the raw `userId` on the complaint after all — directly undoing the
   architecture's stated guarantee.

Both are a real, deliberate tradeoff between this feature's UX and an existing
privacy guarantee — not something to decide unilaterally while implementing a
notifications feature. The existing sanctioned channel for this case is
already in place and untouched: `feedback-notify.ts` emails the submitter's
*voluntary* `contactInfo` (only if they opted in) on a staff reply. If a push
here is wanted anyway, that's a follow-up decision — options include: only
push when the submitter's `contactOptIn` is true (still requires resolving to
a userId to find their subscription, so it doesn't fully avoid the tradeoff),
or accepting the reversal as a one-way, log-nothing lookup used only for
sending push and never surfaced to any admin UI.

**Existing precedent to fold into, not duplicate:** `src/lib/feedback-notify.ts`
already emails a shared staff inbox on exactly the two feedback triggers
above, and its own header comment says it's "an interim channel until the app
becomes a PWA with push notifications... swappable... without touching the
submit/reply logic." Decision: **add** the push send at the same call sites
rather than removing the email — during rollout, push coverage will be
partial (depends on who's granted permission), so the email stays as a
guaranteed-delivery fallback. Revisit removing it once push adoption is
established.

### Broadcast — announcements (**Implemented**)

`announcements` (`src/app/api/admin/announcement/route.ts`, `PUT`) is already
a global singleton banner shown to everyone — no new "message" concept needed
after all. On a `PUT` that leaves it `enabled: true` AND changes `body`
(compared against the existing row before the update — skips a no-op re-save
and a mere `enabled: false` toggle), fan out a push to every row in
`push_subscriptions` via `PushService.sendToAll` (concurrency-capped, per the
Sending section above).

### Sign-out cleanup — design correction

The original draft said "hook the NextAuth `signOut` event server-side." On
closer look that doesn't work: `push_subscriptions.endpoint` is per
*browser/device*, but a user can be signed in on several devices at once, and
the server-side `signOut` event has no way to know **which** endpoint belongs
to the device that's signing out — deleting all of a user's subscriptions on
any one device's sign-out would wrongly kill push on their other, still-active
devices.

Corrected design (**Implemented**): the sign-out **button's click handler**
(`src/lib/push-client.ts`'s `unsubscribePushBeforeSignOut`, wired into all
three `signOut()` call sites — `StudentNav.tsx`, `OnboardingClient.tsx` ×2)
first reads `registration.pushManager.getSubscription()`, and if one exists,
calls `POST /api/notifications/push/unsubscribe` with that endpoint — while
the session is still authenticated — before calling next-auth's `signOut()`.
This is in the critical path of the click handler (not fire-and-forget), so it
reliably fires for the normal "tap sign out" case, which is what the
shared-device threat model above actually needs.

## Implementation notes (2026-09-17)

- **`src/db/migrate.ts` gap caught and fixed.** This project's real prod
  migration runner is the hand-written `migrate.ts` (numbered blocks mirroring
  `drizzle/*.sql`), NOT an automatic runner of the generated SQL files — the
  `drizzle-migration-author` agent correctly generated
  `drizzle/0041_silent_eddie_brock.sql` and the `schema.ts` change, but that
  alone would never have reached prod. Added migration block 93
  (`push_subscriptions` table + index) to `migrate.ts` by hand, rehearsed
  twice against localhost via `/db-local` (clean create, then a clean
  idempotent no-op re-run) before this was considered done. **Still needs a
  real `npm run db:migrate:container` run from the Portainer console before
  deploying** — see `/safe-deploy`.
- **VAPID keys.** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is a BUILD-time value
  (Next.js inlines `NEXT_PUBLIC_*` into the client bundle) — on the
  self-hosted deploy it must be a GitHub Actions repo **Variable** (not a
  Secret; it's meant to reach the browser), wired into
  `.github/workflows/docker-publish.yml`'s `build-args` and `Dockerfile`'s
  `ARG`/`ENV`, exactly like the existing `NEXT_PUBLIC_SONGSUE_DASHBOARD_URL`
  pattern. `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` are ordinary runtime env vars
  in `docker-stack.yml` instead (server-only, optional — sends quietly no-op
  if unset). A real key pair (`npx web-push generate-vapid-keys`) still needs
  to be generated and set as the actual GitHub Variable + Portainer stack
  env vars before this works in prod — a local-only test pair was added to
  `.env.local` (gitignored) for development.
- **Validated:** `npm run lint`, `npm run build`, `npm test` (50 new unit
  tests for the three pure helper files, all passing), and a local migration
  rehearsal. **Not yet validated:** an actual end-to-end push receipt on a
  real device (needs a live VAPID key pair + real browser permission grant +
  triggering one of the write paths) — do this via `/verify` before
  considering Phase 1 fully done, especially the iOS installed-PWA path,
  which can't be exercised from this environment.
