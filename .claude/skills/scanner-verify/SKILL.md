---
name: scanner-verify
description: Structured end-to-end verification of ActiveCAMT's QR attendance scan flow and the PDPA medical-gating-by-role invariant — the most regression-prone subsystem (it caused a 5-PR loop). Use before merging/deploying any change to the scanner, scan API, qr-token, quota logic, or medical gating. Run against the LOCAL DB, never prod data.
---

# Scanner Verify (ActiveCAMT)

A checklist to confirm the QR check-in flow still works AND that medical data isn't
leaked by role. Gating here spans 4 layers (`src/proxy.ts`, `src/lib/access/admin-access.ts`,
the scan API, the scanner UI) — a change to one can silently break another. Verify
behavior, don't assume.

## The flow (what you're verifying)
`signQrToken(userId)` (`src/lib/qr/qr-token.ts`, ~5-min window + ~30s grace) → student shows QR → scanner `POST /api/admin/scan` (rate-limited ~300/min) → `ScannerService.processScan` (`src/modules/events/scanner.service.ts`) → **pre-registered** path (atomic `UPDATE … WHERE status='registered'`) or **walk-in** path (row-lock + quota recount, `totalCap = quota + quotaWalkIn`, `ON CONFLICT DO NOTHING`) → attendance write + `AuditService.logAction`.

## Setup
Use `/db-local` to bring up `activecamt-db` and `seed-author` for fake students/events, then `npm run dev` (or `/run`). Exercise with seeded data only — **never real attendees**.

## Cases to verify
1. **Pre-registered check-in** — a `registered` student scans → status flips to `attended`. Scan again → no double count (the `WHERE status='registered'` guard holds).
2. **Walk-in** — a non-registered student scans an event with walk-in capacity → admitted up to `quota + quotaWalkIn`; the next over-cap walk-in is rejected. Concurrent walk-ins must not exceed cap (row-lock + recount).
3. **Token validity** — an expired token (past window+grace) is rejected; a tampered token is rejected; the intended manual/legacy fallback still works.
4. **PDPA medical gating by role (CRITICAL)** — log in as each role and inspect the **actual JSON** of the scan response (Network tab), not just the UI:
   - `super_admin`/`admin` → may include medical **detail**.
   - `registration`/`organizer`/`smo` → only the medical **signal**, never detail — and confirm any `pending_confirmation`/nested payload doesn't smuggle detail into JSON that the UI happens to hide.
5. **SMO confinement** — `smo` can reach `/admin/scanner` only; `action=score` / `action=lookup` are rejected server-side for non-`SCORING_ROLES`.
6. **Audit** — every successful check-in writes an `audit_logs` row.

## Hard rules
- Local data only — never test against prod attendees/PII.
- The PDPA check (#4) must inspect the network response per role, because a leak can be invisible in the UI but present in the JSON.

## Output
Pass/fail per case (1–6), with case #4 (medical gating by role) and #2 (quota race) called out explicitly. For deeper coverage, pair with `test-author` (unit tests for `qr-token` + `admin-access`) and `pdpa-access-guard` (static review, including its route+audit checklist). `/verify` is the general live-run skill; this is its scanner-specialized recipe.
