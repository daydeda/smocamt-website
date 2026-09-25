# Shop fulfilment (handover tracking)

**Status:** built on `feat/shop-fulfillment` (2026-09-26).
**Question it answers:** after a buyer pays, did they actually *get* the item?

`shop_orders.status` is only the **payment** review (`pending` → `approved`/`rejected`).
Fulfilment is a separate column, `fulfillment_status`, that only moves once an order is
`approved`. The transition table lives in one place, `nextFulfillmentStatus()` in
`src/lib/shop-fulfillment.ts`, and both the UI buttons and every route use it.

## The three ways an order completes

| Buyer chose | How we know they got it | Final status |
|---|---|---|
| Self-pickup | Staff **scan the buyer's Digital ID** at the counter | `picked_up` |
| Delivery, on campus | Staff **scan the buyer's Digital ID** at the door | `delivered` |
| Delivery, by mail | Seller enters **carrier + tracking number**, then the buyer taps **"I received it"**, or it auto-confirms after **7 days** | `delivered` |

```
self-pickup:        awaiting → ready (optional, notifies buyer) → picked_up
delivery, campus:   awaiting → delivered
delivery, mail:     awaiting → shipped → delivered   (fulfilled_via = buyer | auto)
                               shipped → issue       (buyer "Report a problem"; stops auto-confirm)
                               issue   → shipped     (seller sends a replacement) / delivered
any non-awaiting:   → awaiting                        (staff "Reset handover", undo a mistake)

in person, line by line (v2.20.0):
awaiting / ready → partial → picked_up / delivered   (some lines handed over, then the rest)
partial / picked_up / delivered → partial / ready / awaiting   (counter "Undo" of specific lines)
```

### Per-line handover

One order can hold several products (a buyer checks out a whole cart from one seller), and
those are often handed out at different booths or on different days. So the in-person
handover stamps **order lines** (`shop_order_items.handed_over_at` / `handed_over_by`), and
the order sits in `partial` until every line is stamped. A mailed parcel is settled whole:
from `shipped` / `issue` every remaining line must go at once. `isItemHandedOver()` treats
every line of a finished order as handed, so orders that completed by buyer confirmation
(or before per-line handover existed) need no backfill.

`fulfilled_via` records how it ended: `qr` (Digital ID scan), `manual` (staff tapped
"Handed over" on the card, e.g. a friend collected it), `buyer`, or `auto`.

## Carriers

`SHOP_CARRIERS` in `src/lib/shop-fulfillment.ts`: Thailand Post (EMS / registered), Flash,
KEX (formerly Kerry), J&T, SPX (Shopee Express), Ninja Van, a **same-day courier**
option (Lalamove / Grab / LINE MAN, which give a tracking **link** instead of a number),
and **Other** (the seller types the name).

"Track parcel" opens the carrier's **official tracking page** and copies the number to the
clipboard first. We deliberately don't build deep links with the number in the URL: none
of these carriers document a stable format, and a guessed one breaks without any error.
Seller-supplied links must be `https://`.

## Where it lives

- **Handover counter** (`ShopHandoverScanner.tsx`): staff **choose the product first**
  (`ShopHandoverProducts.tsx`: photo, seller and price, with same-name products flagged),
  then scan. Only that product's lines can be ticked; the buyer's other products are listed
  greyed out. Opened from **Hand over items (scan Digital ID)** on `/admin/shop` → Orders,
  or from the **Shop** tab of `/admin/scanner` (`ScannerShopTab.tsx`, shown to
  `isShopManager`; a seller-only account can't reach the scanner page and uses the shop
  button). The camera viewfinder is shared with the prize booth
  (`src/components/admin/QrViewfinder.module.css`).
- **Admin card** (`/admin/shop` → Orders): a *Handover* section on every approved order,
  with Ready for pickup / Mark as shipped / Hand over manually (a checklist of lines,
  nothing pre-ticked) / Reset, plus a ✓/🕒 per line on a `partial` order. Filters *To hand
  over* (includes `partial`), *Shipped* and *Problem*. (`ShopFulfillmentControls.tsx`)
- **Buyer** (`/dashboard/shop` → My Orders): pickup instructions + "Open Digital ID", or
  carrier, tracking number, Copy / Track parcel, **I received it**, **Report a problem**.
- **APIs**
  - `PATCH /api/admin/shop/orders/[id]/fulfillment`: `ready | ship | handover | reset`
    (`handover` takes `itemIds`, the ticked lines of this order; `reset` also clears the line stamps)
  - `GET /api/admin/shop/fulfillment/products`: the counter's product picker, scoped, with waiting counts
  - `POST /api/admin/shop/fulfillment/scan`: `preview` / `confirm` with a `productId`, plus
    `undo` of specific lines (same two-step shape as the prize booth)
  - `PATCH /api/shop/orders/[id]/fulfillment`: buyer `confirm | report` (own orders only)

## Rules worth knowing

- **Scope** is the same as payment review: a seller/president may only act on an order
  whose every line item is theirs (`classifyOrdersByScope(...).fullyOwned`); a mixed order
  stays with a shop admin. The scanner shows a president only their own orders.
- **Scan confirm** re-verifies the QR (tokens live ~5 min) and locks each order, then
  re-reads its lines under the lock: every line must belong to the scanned buyer, be the
  chosen product, be paid, and not be handed over yet. Unpaid and mailed lines are listed
  as "don't hand over" and can't be confirmed. The shared logic is `handOverItems()` /
  `undoItemHandover()` in `src/lib/shop-fulfillment-server.ts`.
- **Human-error guards at the counter:** the chosen product stays pinned at the top; size /
  option and quantity are the largest text; "already received", "not paid" and "sent by
  mail" show before the list; the confirm button states the item count; the same QR is
  ignored for 8 s after a handover; the success screen has **Undo**; tapping outside the
  dialog never discards a scanned result. Editing a line that was already handed over is
  refused (undo the handover first).
- **Reject / revert to pending is refused** once goods have left the seller (`shipped`,
  `partial`, `picked_up`, `delivered`, `issue`); reset the handover first. This stops "rejected" and
  "picked up" appearing on the same order.
- **Auto-confirm has no cron.** The self-hosted deploy runs no scheduler (the
  `vercel.json` crons don't run there), so `autoConfirmDueShipments()` runs at the top of
  the buyer's order list and the admin queue reads. It's idempotent, and `issue` orders
  are never auto-completed.
- **Audit:** every staff action (ready, ship, handover, reset, scan preview) writes to
  `audit_logs`. Buyer confirm/report and auto-confirm are recorded on the order row
  itself (`fulfilled_via`, `issue_note`, `issue_at`).
- **Existing orders** all start as `awaiting` after the migration; nothing is inferred.
  Old orders that were already collected will appear under *To hand over* until someone
  marks them.

## Migration

`src/db/migrate.ts` step 97 (mirrors `drizzle/0045_rainy_crusher_hogan.sql`) and step 98
(per-line handover, mirrors `drizzle/0046_safe_captain_midlands.sql`). It only adds
columns, is idempotent, and destroys nothing. Run `npm run db:migrate:container` from the
Portainer console **before** deploying this code, because the order lists read the new columns.
