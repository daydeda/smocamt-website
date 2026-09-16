# Feature — Club/major-president scoped shop

**Status: IMPLEMENTED** (`feat/shop-president-scope`).

This ownership scope now composes with the implemented marketplace in
`shop-marketplace.md`: a club/major president first applies for seller approval,
then receives a seller-owned payout/fulfilment profile while the existing
club/major owner fields continue to constrain which organization the product is
listed for.

## Problem

The shop was global and gated to `super_admin`/`admin` only (`isShopAdmin`,
`src/lib/shop-auth.ts`). `shop_products` had no owner column, so any president
who could reach `/admin/shop` (because their account also held `admin`) saw
every product and every order — buyer PII and payment slips included.

## Model

`shop_products` gains `owner_club_ids jsonb` + `owner_majors jsonb` — the exact
analogue of `events.owner_club_ids` / `owner_majors`. They scope **admin-side
management only**; they do NOT affect storefront visibility (that's still
`allowed_roles` / `allowed_majors`). Both empty/NULL = a **central** product:
`super_admin`/`admin` only, hidden from every president. Existing products are
all central until an admin assigns an owner.

- `isShopAdmin(session)` — `super_admin`/`admin` plus SMO Finance. The *unscoped*
  gate (global settings, seller/product review, "see everything").
- `isShopManager(session)` — `isShopAdmin`, `club_president`,
  `major_president`, or the additive `shop_seller` capability. The page gate and
  every `/api/admin/shop` route then resolve a DB-backed seller/organization scope.
- Scope resolution reuses `EventScopeService.getPresidentScope(userId, roles)` →
  `{ clubIds, majors }`. `resolveShopAccess(session)` (`src/lib/shop-scope.ts`)
  returns `{ unscoped: true }` or `{ unscoped: false, scope }`.
- Pure predicates in `shop-auth.ts`: `isProductOwnedByScope`,
  `filterProductsByScope`, `isOwnerAssignmentWithinScope` (a president can never
  create/keep a central product, nor assign one outside their scope). Unit
  tests: `src/lib/shop-auth.test.ts`.

## Behaviour for a scoped president

| Surface | Scoped president |
|---|---|
| `/admin/shop` products | Only products their club/major owns. Create forces an owner within their scope. Edit/delete only their own; can't re-assign outside scope or make central. |
| Per-product `.xlsx` export | Only for a product they own. |
| Orders review queue | Only orders with ≥1 line item for a product they own. Other teams' line items in a mixed order are **stripped** from the response. Buyer contact/shipping shown (needed for fulfilment) and audit-logged. |
| Approve / reject / revert + view slip | Only for an order where **every** line item is theirs (`fullyInScope`). A mixed-club order is read-only for them — a shop admin reviews it. |
| Shop settings (QR, payment info, flat-fee delivery, pickup instructions) | Available after the president's seller application is approved; stored on that seller identity, never in the global SMO settings. |
| Product publication | A president-created product starts `pending`; `admin`/`super_admin`/SMO Finance must approve it before the storefront exposes it. |

The accountability mechanism for the broadened access is the audit log (same
posture as the club/major-president medical-detail tier in `CLAUDE.md`).

## 4-layer gate

`/admin/shop` added to `SCANNER_ONLY_PAGES` (`admin-access.ts`) + a branch in
`admin-nav-config.ts scannerOnlyAllowed`, so the proxy and nav let presidents
in; the page's `isShopManager` gate bounces `smo` back out.

## Files

- Schema/migration: `src/db/schema.ts`, `drizzle/0036_groovy_eddie_brock.sql`,
  `src/db/migrate.ts` (idempotent `ADD COLUMN IF NOT EXISTS`).
- Access: `src/lib/shop-auth.ts`, `src/lib/shop-scope.ts`,
  `src/lib/shop-product-schema.ts`, `src/lib/admin-access.ts`,
  `src/lib/admin-nav-config.ts`.
- Routes: `src/app/api/admin/shop/{products,products/[id],products/[id]/orders,orders,orders/[id],context}/route.ts`,
  `src/app/api/shop/orders/[id]/slip/route.ts`.
- UI: `src/app/admin/shop/{page.tsx,AdminShopClient.tsx}`.

## Deploy

Additive, nullable columns — non-destructive. Run
`npm run db:migrate:container` from the Portainer console before recreating the
image (`/safe-deploy`). Post-deploy: an admin assigns owners to the products
that should belong to a club/major; everything else stays central.
