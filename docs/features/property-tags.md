# Property tags (ป้ายทรัพย์สิน)

Printed QR stickers that staff stick on a student's belongings (bag, phone, …) and then scan to record who owns them. Anyone signed in who scans a sticker can check "is this mine?" and sees only the owner's **name, student ID, major and year**.

## Flow

1. **Create a group** at `/admin/property-tags`. A group is what the stickers are for, e.g. "Bag for Trekking".
2. **Generate tags** in the group: pick a **series** (`STU`, `SMO`, `ANU`, …) and a count (1–1000 per batch). Each tag gets:
   - a **serial label** `SERIES-NNN` (`SMO-014`). Numbering is per series **across all groups**, so no two stickers ever carry the same label;
   - a **random 10-character code** (Crockford base32, 50 bits). This is the only thing that resolves a tag to its owner, and it's printed under the QR as a fallback for typing.
3. **Print** at `/admin/property-tags/<id>/print`: choose tags per A4 page (1–80), only-empty / series / serial range filters, then print or save as PDF from the browser. The layout maximises QR size and warns below 20 mm. It also warns when the page isn't on an https public origin, because the origin is baked into every QR (`<origin>/t/<code>`).
4. **Assign**: scan a tag in the scanner's **Tags** tab, or use "Scan to assign" / "Manage" on the group page. Then:
   - **Student's Digital ID (preferred):** the same camera reads both QR kinds, in either order. Scan the student's Digital ID first and the next tag scanned goes straight to the confirm step; or, with a tag open, tap *Scan student's Digital ID*. `POST /api/admin/property-tags/resolve-student` accepts only the signed 5-minute token (never a raw user id), so an expired or forged code is rejected.
   - **Empty tag, no Digital ID:** search for a student (name, nickname, student ID, phone or contact channel; results show a masked phone `•••1234`) → preview → confirm.
   - **Owned tag:** **Change owner** (same flow), or **Remove owner**, which empties the sticker so it can be reused.
5. **Student view** `/t/<code>`, opened by the phone camera: shows "This is yours" for the owner, otherwise "This item belongs to" plus a return-it hint.

## Rules

- **Who can manage:** `super_admin`, `admin`, `smo` (which includes the registration desk, `smo` + smoPosition `registration`) all with full rights (an `anusmo` holding the `registration` position is a check-in-only desk and is excluded) (`PROPERTY_TAG_ROLES` in `src/lib/access/admin-access.ts`). Presidents and sellers are excluded. The server gate is `resolvePropertyTagStaff` (`src/lib/property-tags/property-tag-access.ts`).
- **Viewing an owner** requires a signed-in, onboarded account. `/t/*` is a public route in `src/proxy.ts` only so it can render its own sign-in prompt that returns to the same sticker. Lookups are rate-limited to 30/min per viewer. The page is `noindex`.
- **The owner is read live** from `users`, so a name change shows immediately. The owner's role is never returned.
- **The series is stock-keeping only.** Giving an `SMO-`/`ANU-` tag to someone without that role shows a soft warning at assign time. Nothing re-checks it later, so a tag stays valid after its owner leaves SMO. Owning another tag in the same group also only warns.
- **Concurrency:** assign/unassign send the owner the staff member saw (`expectedOwnerId`). If someone else changed the tag in between, nothing is written and the panel says to rescan.
- **Audit:** group create/update, generate, assign, reassign and unassign all write `audit_logs` in the same transaction.
- **Delete only when no tag has an owner.** `DELETE /api/admin/property-tags/[id]` removes a group and its tags, and answers 409 while any tag is still assigned, since that sticker is on someone's bag. Staff remove the owners first, or archive the group, whose tags keep resolving. Deleting is audit-logged. The printed stickers of a deleted group stop resolving.
- **Printing:** the print page offers **Download PDF** (exact A4 geometry, vector QR, built in the browser by `src/lib/property-tags/property-tag-pdf.ts`). There is no browser Print button on purpose: Safari and Chrome rescale the page and add their own header and footer, so the PDF is the one way to print.
- **Group page:** the tag table is paginated (25/50/100/200 per page) so groups with thousands of tags stay fast.

## Data

`property_tag_groups` and `property_tags` (`src/db/schema.ts`; `drizzle/0048_steady_red_wolf.sql`; `migrate.ts` step 100). Unique `code`, unique `(series, serial)`.
