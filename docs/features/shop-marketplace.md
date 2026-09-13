# Feature Spec — Multi-Seller Shop (ระบบร้านค้าหลายผู้ขาย)

> **STATUS: DESIGN COMPLETE — NOT YET IMPLEMENTED.**
> Planning doc only — no schema, routes, or UI exist yet. All decisions in §8
> are signed off; this is ready for a `drizzle-migration-author` +
> `new-admin-route` implementation pass.

---

## 1. Context / บริบท

Today's shop (`src/app/api/shop/**`, `src/app/admin/shop/**`, `src/lib/shop-*.ts`)
is single-seller by design: one `shopSettings` singleton row holds one PromptPay/
bank QR (`qrImageUrl`) and one payment-instructions blob (`paymentInfo`), shown to
every buyer for every product. `isShopAdmin` (`src/lib/shop-auth.ts`) gates *all*
shop management — product create/edit, settings, order review — to
`super_admin`/`admin` only, with a comment explicitly stating why: "registration/
organizer can enter `/admin` but must not touch money/merch." The shop was built
assuming one trusted party (the student association) collects payment for
everything it lists.

The ask: open the shop so people **other than the student association** — other
clubs, majors, or individuals — can list and sell their own items, each collecting
payment into their **own** account. That breaks the single-QR assumption at the
root and changes who's trusted to review orders and touch payment info.

**Relevant reality check (see updated `CLAUDE.md` Stack section):** login is
*already* open to any Google account today — the `@cmu.ac.th` domain restriction
described in `src/auth.ts`'s `FE-01` comment was never wired up in code and is
pending CMU IT (see `docs/features/feedback-complaints.md` §2). So "let people
outside the current admin/officer roles sell things" is not blocked by auth at
all — anyone can already get an ActiveCAMT account. The actual gap is
**authorization**: nothing today lets a non-`admin` account manage products, set a
payment QR, or review orders for money it's the only one that should see.

This spec also assumes the just-shipped free slip pre-filter
(`src/lib/shop-slip-verify.ts` — duplicate-image/duplicate-QR/no-QR detection,
see git history on `feat/shop-slip-auto-verify`) stays in place and is
seller-agnostic: duplicate detection stays **global** across all sellers (a slip
reused between two different sellers' orders is still fraud), only the *review
queue UI* becomes scoped per seller.

## 2. Trust boundary this changes

This is the part worth pausing on before anything else: today's `isShopAdmin`
gate exists *because* real money changes hands, and it deliberately keeps that
to the two most-trusted roles. A marketplace model means an ordinary account —
one that logged in with any Google address, no CMU affiliation required — can
end up with a live payment QR shown to other students and a queue of buyers'
personal data (name, student ID, phone, shipping address — see the PDPA section
in `CLAUDE.md`) to review. That's a materially different risk profile from "an
admin we already vetted manages the one shop."

**Decided (§8.1):** sellers are **approved, not self-serve**. Anyone who has
completed normal onboarding can *apply* to become a seller; `admin`/
`super_admin`/SMO-Finance approve or reject the application before it can list
anything or receive a payment QR.

## 3. Data model

### New: `shop_sellers`
```
id            uuid PK
userId        text FK -> users.id, NOT NULL, unique (one seller identity per account)
displayName   text NOT NULL         -- shown on product listings, e.g. "SMO Merch", "Jane's Bakery"
status        text NOT NULL default 'pending'   -- 'pending' | 'approved' | 'suspended'
paymentInfo   text NOT NULL default ''          -- rich-text instructions, same as today's shopSettings.paymentInfo
qrImageUrl    text                              -- this seller's own PromptPay/bank QR image
appliedAt     timestamptz default now()
reviewedBy    text                              -- admin who approved/suspended, for audit
reviewedAt    timestamptz
```
A `suspended` seller's existing products are hidden from the storefront and
existing pending orders freeze (can't be approved/rejected further) until
un-suspended — mirrors how `shopProducts.isActive` already hides a single
product without deleting its order history.

### `shop_products` — add
```
sellerId        uuid FK -> shop_sellers.id, NOT NULL
approvalStatus  text NOT NULL default 'approved'  -- 'pending' | 'approved' | 'rejected'
approvalReason  text                               -- shown to the seller on rejection
reviewedBy      text                               -- admin/super_admin/smo-finance who decided
reviewedAt      timestamptz
```
`approvalStatus` is detailed in §6 — default `'approved'` covers every existing
row and everything staff (`admin`/`super_admin`/SMO-Finance) create going
forward; only `shop_seller`-created products insert as `'pending'`.

One seller = one payment account = one QR (not per-product), which is the
simplest model that satisfies "different item types [sellers], not just the
student association" without per-item QR sprawl. A seller who genuinely needs
two payout accounts is two `shop_sellers` rows (e.g. two contact emails), not a
new axis on `shop_products`.

Existing rows need a backfill seller during migration: create one
`shop_sellers` row (`displayName: "SMO / CAMT"`, `status: 'approved'`) owned by
a designated admin account, and set every current `shop_products.sellerId` to
it. `shop_settings.paymentInfo`/`qrImageUrl` move onto that row; the singleton
`shop_settings` table keeps only shop-wide, non-payment config (`enabled`,
delivery defaults, `pickupInfo`).

### `shop_orders` — add
```
sellerId          uuid FK -> shop_sellers.id, NOT NULL
checkoutGroupId   uuid    -- ties together sub-orders created from one checkout
```
An order becomes single-seller. A cart with items from two sellers produces
**two** `shop_orders` rows (two slips, two payment flows) sharing one
`checkoutGroupId` so the buyer's order history can still visually group "the
things I bought at once" even though they're independent backend orders,
independently approved/rejected by their own seller. This directly answers your
"split into one sub-order per seller" choice — see §4.

## 4. Checkout flow

1. Buyer's cart can hold items from multiple sellers (current cart UI already
   just lists variant selections; no seller concept to enforce today).
2. At checkout, group cart lines by `product.sellerId`. Render **one payment
   block per seller present** — that seller's QR/instructions, one slip-upload
   input each.
3. Submit creates `N` `shop_orders` rows (one per seller group), but **not** as
   one all-or-nothing transaction across every seller (decided, §8.3) — each
   seller-group is validated and inserted independently (its own
   transaction/savepoint, same per-order stock/limit/eligibility logic
   `POST /api/shop/orders` already runs today), sharing only the
   `checkoutGroupId`. A stock-out on seller A's item does not block seller B's
   otherwise-valid sub-order.
4. The response reports success/failure **per seller group** — the buyer sees
   exactly which seller(s)' items went through and which failed and why (e.g.
   "SMO Merch: ordered ✓ — Jane's Bakery: out of stock ✗"), not one opaque
   whole-cart error.
5. The free slip pre-filter (§1) runs per sub-order exactly as it does today —
   `classifySlip` still compares against **every** prior non-rejected slip
   platform-wide, not scoped to the seller, since slip reuse across sellers is
   still the same fraud pattern.

## 5. Order review & access control

New role: **`shop_seller`**. Added to `src/lib/admin-access.ts`'s
`ADMIN_ENTRY_ROLES` and to a new `SHOP_SELLER_ONLY_ROLES`-style confinement
(mirrors the existing `SCANNER_ONLY_ROLES` pattern exactly) that restricts entry
to `/admin/shop` only — everything else in `/admin` stays closed to them, same
posture as `smo`/`club_president` today.

**SMO Position Finance also gets full `/admin/shop` access**, on the same
footing as `admin`/`super_admin` (not scoped to one seller) — i.e. a user with
`roles.includes("smo") && smoPosition === "finance"`. `finance` is already a
canonical position id (`src/lib/positions.ts`), so this needs no new position,
just a new predicate in `admin-access.ts` mirroring the existing
`isGlobalRegistrationPosition(roles, smoPosition, anusmoPosition)` shape (call
it `isShopFinancePosition`) — checked everywhere `isShopAdmin` is checked today,
proxy included.

`isShopAdmin` (`src/lib/shop-auth.ts`) becomes a scope resolver, mirroring
`EventScopeService`'s shape rather than its club/major-membership mechanics
(this is simpler — direct FK ownership, not derived from `club_members`):

```ts
type ShopScope = { unscoped: true } | { unscoped: false; sellerId: string };
function getShopScope(session): ShopScope | null {
  // super_admin/admin, or smo+finance (isShopFinancePosition) -> { unscoped: true }
  // shop_seller -> { unscoped: false, sellerId: <their shop_sellers.id> }
  // anything else -> null (no access)
}
```

Every `api/admin/shop/**` route applies this scope **server-side** (per
`CLAUDE.md`'s standing rule: UI/proxy gating is never sufficient on its own) —
products, orders, and the slip-review queue all filter by `sellerId` unless
`unscoped`. The flagged-order review UI just shipped
(`AdminShopClient.tsx`'s "Needs review" chip) needs no logic change, only a
scoped query underneath it — a seller's queue is already exactly "the orders
this endpoint returns," so scoping the endpoint scopes the UI for free.

`shop_sellers` itself needs its own admin surface: an approval queue
(`/admin/shop` gets a "Sellers" tab, `admin`/`super_admin`-only) to
approve/suspend applications, plus a "become a seller" application entry point
on the student-facing side for anyone to submit.

## 6. Product approval

A `shop_seller`'s product does not go live the moment they save it — it needs
one sign-off from `admin`/`super_admin`/SMO-Finance first, so someone trusted
checks correctness (price, description, whether it's something the shop should
even carry) before buyers can see or order it. Decided:

- **Single approval, not two-person.** `shop_products` gets
  `approvalStatus: text default 'approved'` (`'pending' | 'approved' | 'rejected'`)
  + `approvalReason: text` (shown to the seller on rejection, same UX pattern as
  `shopOrders.rejectionReason`) + `reviewedBy`/`reviewedAt`. Any one of
  `admin`/`super_admin`/SMO-Finance flipping it to `approved` is sufficient —
  no dual sign-off, mirrors how `isShopAdmin` already treats those roles as
  interchangeable rather than requiring two of them to agree on anything else
  in the shop today.
- **Scoped to `shop_seller`-created products only.** A product created by
  `admin`/`super_admin`/SMO-Finance (i.e. an unscoped shop-staff session — see
  `getShopScope` in §5) is inserted as `approvalStatus: 'approved'` immediately,
  exactly like today's instant-publish behavior — the review gate exists
  specifically because `shop_seller` accounts are outside that trusted circle,
  not as a new internal control on staff's own listings.
- **Storefront query** (`GET /api/shop`, the buyer-facing list) adds
  `AND approval_status = 'approved' AND is_active = true` — a pending/rejected
  product simply doesn't exist as far as a buyer can tell.
- **Seller's own product list** (`/admin/shop` scoped to their `sellerId`) shows
  the status plainly (pending / approved / rejected + reason), same badge
  pattern `AdminShopClient.tsx` already uses for order status.
- **Reviewer queue**: `admin`/`super_admin`/SMO-Finance's `/admin/shop` Products
  tab gets a "Pending approval" filter alongside the existing product list, so
  a new seller listing doesn't require someone to notice it by accident.
- **Audit log**: approving/rejecting a product writes an `AuditService` entry
  (`AuditService.logActionInternal`), matching the existing pattern in
  `api/admin/shop/products/[id]/route.ts` and `.../orders/[id]/route.ts` — not
  a PDPA-medical-data case, but still an accountability trail for who let what
  get listed.
- Editing an already-approved product (price change, restock) does **not**
  reset it to pending in this v1 — only creation goes through the gate. Worth
  revisiting if sellers turn out to abuse edits to slip in different items
  post-approval (open question, not blocking).

Note this is a *separate* decision from `shop_sellers.status` in §2/§8.1 (whether
becoming a seller *at all* requires approval) — product approval is a real
backstop even if seller signup stays self-serve, since nothing a new seller
lists is visible until someone checks it. It doesn't fully replace the seller-
approval question, though: a bad-faith account can still submit junk/spam
listings for a reviewer to wade through, which is friction pending-approval
doesn't remove.

## 7. Money & liability framing

Worth stating explicitly since it's a product decision, not an engineering one:
**ActiveCAMT never touches seller funds.** Each seller's QR pays directly into
their own account; the platform lists products and routes buyer/order data —
it is not a payment processor and holds no float. Disputes about a seller's own
fulfillment (wrong item, no delivery) are between buyer and seller; ActiveCAMT's
role stops at "here's the slip, here's whether our free pre-filter flagged it."
This should be stated somewhere buyer-facing too (e.g. shop FAQ/terms text) once
built, not just in this doc.

## 8. Decisions (was: open questions)

1. **Seller approval** — same reviewer set as product approval (§6):
   `admin`/`super_admin`/SMO-Finance, any one of them. `shop_sellers.status`
   (§3) is approved by the same people who approve that seller's products —
   one consistent reviewer set across the whole marketplace-trust surface, no
   separate lighter-weight approver role.
2. **Payout info structure** — freeform `paymentInfo` blob + one `qrImageUrl`
   for v1, matching today's `shopSettings` exactly (§3's `shop_sellers` shape
   is already written this way — no change needed there). Structured payout
   fields (account name/number/PromptPay ID) are explicitly **deferred**, not
   forgotten — see §9. This means there is still no automated way to confirm a
   slip actually paid a *specific* seller's account; `shop-slip-verify.ts`'s
   duplicate/no-QR checks (global, seller-agnostic) plus a human glancing at
   the seller's own posted QR are what's currently doing that job.
3. **Partial checkout failure** — a multi-seller checkout is NOT all-or-
   nothing; per-seller-group atomicity instead, each reported to the buyer
   individually. See §4 steps 3–4 (already written this way).
4. **Seller identity vs student identity** — becoming a `shop_seller` requires
   **first completing normal onboarding** (`OnboardingClient.tsx` — studentId
   when applicable, major, etc.), same identity-completeness bar as every
   other account. The seller application is an *additional* step on top of an
   already-onboarded account, not a bypass — so a `shop_seller` still has a
   normal role (`student`/`professor`/`officer`/etc.) plus the seller
   capability layered on, not a role that replaces onboarding.
5. **Platform fee** — no, never. Confirmed: `shop_orders`/`shop_sellers` need
   no commission/fee field; §6's liability framing ("ActiveCAMT never touches
   seller funds") stands as designed, nothing to revisit here.
6. **Naming** — **Seller / ผู้ขาย**, used consistently for the role name
   (`shop_seller`), the UI label, and this doc going forward.

## 9. Out of scope for v1 (explicitly deferred, not forgotten)

- Per-product payout accounts (one seller = one account, §3).
- Automated destination-account verification (§8.2) — the free slip pre-filter
  already catches reuse/no-QR; matching the *paid-into* account needs either a
  paid bank-verify API (previously ruled out on cost) or structured payout
  fields plus manual admin cross-check.
- Seller-side analytics/payout reporting beyond what `AdminShopClient.tsx`
  already gives an admin for their own orders.
- Ratings/reviews of sellers.
