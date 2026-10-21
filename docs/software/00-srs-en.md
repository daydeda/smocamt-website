# Software Requirements Specification (SRS)

> **English translation (derived).** Canonical source: `00-srs-th.md` (Thai). This file is a development-reference translation and may lag the Thai original. For funding/official use, the Thai version governs.

**System name:** Real-time activity and house-score management platform (ActiveCAMT)
**Version:** 1.2 (adds: PDPA medical signal/detail access split, SMO scanner-only role, house rosters + attendee export, and registration-cancellation lock. v1.1 added: KAS form system, HMAC-based QR, tamper-evident hash-chain audit log, per-individual leaderboard, registration quotas/time windows, multiple posters per event)
**Last updated:** 16 June 2026
**Status:** Complete (ready to present to the committee and system admins)

---

## 1. Introduction

### 1.1 Purpose
This document describes the technical detail, functional requirements, and non-functional requirements of the **ActiveCAMT** project, so that the university's activity management runs more transparently, securely, and efficiently.

### 1.2 System Scope
The system is a Modular Monolith running on Next.js 16 (App Router). Its core capabilities are grouped as follows:

* **User and permission management:** new-student onboarding, PDPA-compliant health-data storage (registration staff see only the *signal* that a medical condition exists; the *detail* and meds-check are admin-only), and multi-level roles (student, smo, anusmo, registration, organizer, admin, super_admin) — with SMO being scanner-only (may enter /admin but is confined to the QR scanner).
* **Registration and check-in:** Dynamic QR signed with HMAC (5-minute lifetime), two-step check-in scanner (Scan → Confirm), registration open/close windows, and multi-tier quotas (total quota, separate Thai/international quotas, and an additive Walk-in quota).
* **KAS form system:** one event can have multiple forms (K_pre, K_post, A, S) with a Google Forms-style UI, supporting sections, answer-based branching, quiz scoring, automatic close/award by time, and XLSX export.
* **Scores and leaderboard:** real-time accumulation of house scores and per-individual scores, with self-rank and an "Unranked" status.
* **Security and auditing:** tamper-evident audit log (SHA256 hash chain), security headers/CSP, and permission-based data filtering to comply with PDPA.
* **User experience:** multiple swipeable posters (swipeable carousel), full-screen zoom (pinch/double-tap/wheel), and 4-language support (EN, TH, MM, CN).

---

## 2. Project Architecture & Codebase Structure

ActiveCAMT follows ESM standards, TypeScript strict mode, and uses a path alias (`@/*` pointing to `src/*`), as follows:

```
src/
  ├── app/                        <── [Routing & Controllers]
  │   ├── layout.tsx              <── main layout and HTML wrapper
  │   ├── page.tsx                <── landing page and login gatekeeper
  │   ├── globals.css             <── centralized CSS-first styling (Tailwind v4)
  │   ├── onboarding/             <── new student first-time data entry page
  │   ├── dashboard/              <── student-side dashboard
  │   │   ├── page.tsx            <── dashboard home showing QR and stats
  │   │   ├── profile/            <── profile editing and dynamic health-data fields
  │   │   ├── history/            <── activity history + evaluation forms
  │   │   └── houses/             <── house leaderboard and score history
  │   ├── admin/                  <── admin / officer side
  │   │   ├── layout.tsx          <── layout + menu and admin-side permission guard
  │   │   ├── dashboard/          <── check-in stats summary and real-time feed
  │   │   ├── events/             <── event management and form builder
  │   │   ├── students/           <── search student list and view health data
  │   │   ├── scanner/            <── QR check-in camera scanner page
  │   │   └── audit-logs/         <── security log history, cannot be edited/deleted
  │   └── api/                    <── [Route Handlers]
  │       ├── auth/               <── NextAuth
  │       ├── upload/             <── file upload handling (5MB limit)
  │       ├── realtime/           <── stream real-time data via SSE
  │       └── admin/...           <── admin-only routes
  ├── components/                 <── [Reusable UI Components]
  ├── db/                         <── [Database & ORM]
  │   ├── schema.ts               <── Drizzle schema definitions
  │   └── index.ts                <── central DB connection point (PostgreSQL client)
  ├── lib/                        <── [Helpers / Utilities]
  │   ├── i18n.ts                 <── 4-language translation dictionary (EN, TH, MM, CN)
  │   ├── LanguageContext.tsx     <── client-side language management context
  │   └── realtime-emitter.ts     <── broker relaying signals across worker threads via disk
  └── modules/                    <── [Service Layer / Business Logic]
      ├── users/                  <── user and permission management service
      ├── events/                 <── quota and check-in validation service
      ├── houses/                 <── score calculation and leaderboard service
      └── audit/                  <── audit log writing service
```

---

## 3. Comprehensive File Directory

Below is a breakdown of the responsibilities of each main file in the system, to enable in-depth review:

### 3.1 System, Security & Central Config Files (Configuration & Auth)

#### 📂 [src/auth.ts](file:///E:/OnlyWork/SMO Meetings/Web/activecamt/src/auth.ts)
* **Main responsibility:** handles login, authentication, and sessions via NextAuth v5 (beta) together with the Google provider and `@auth/drizzle-adapter`.
* **Internal logic:**
  * Restricts login to emails ending in `@cmu.ac.th`.
  * Stores `role` (student, smo, anusmo, registration, organizer, admin, super_admin) in the JWT.
  * **[CRITICAL] dynamic session sync:** in the `jwt` callback, intercepts the `trigger === "update"` signal to rewrite the session cookie immediately after a student finishes onboarding or editing their profile, so they can enter the dashboard right away without logging out to refresh their permissions.
  * **[FIX] role lockout fix:** a user with an empty `roles[]` but a single `role` is no longer locked out of admin (the permission check was consolidated to read both shapes).
  * Defines the auth options and session expiry.
  * **[NEW] server-side admin landing by role:** the post-`/admin` landing page is decided on the server so the SMO role is routed straight to the QR scanner automatically.

#### 📂 [src/proxy.ts](file:///E:/OnlyWork/SMO Meetings/Web/activecamt/src/proxy.ts)
* **Main responsibility:** the outermost middleware that gates route access before every other guard.
* **Internal logic:**
  * **[CRITICAL] first gating layer:** this middleware **runs before** other guards (such as the one in `admin/layout.tsx`), so it is an easy point to miss/overlook when adjusting permissions.
  * **SMO scanner-only:** lets the SMO role through to `/admin` but confines it to the QR scanner page only (the Admin Panel button is shown and routes to the scanner; no other admin area is visible).
  * **Single source of truth:** consolidates the "SMO can only scan" policy in one place that every gating layer references, instead of spreading the logic across multiple places.

#### 📂 [src/db/schema.ts](file:///E:/OnlyWork/SMO Meetings/Web/activecamt/src/db/schema.ts)
* **Main responsibility:** defines the database table schema in TypeScript via Drizzle ORM.
* **Internal logic:**
  * The `users` table stores multi-level roles (`roles`), profile image, profile status (`profileCompleted`), and **PDPA health data stored as encrypted fields directly in the users table** (chronic diseases `chronicDiseases`, medical history `medicalHistory`, drug allergies `drugAllergies`, food allergies `foodAllergies`, fainting history `faintingHistory`, emergency medication `emergencyMedication`, emergency contacts `emergencyContacts`) — not in a separate table.
  * The `auditLogs` table is for security logging, **append-only and tamper-evident** — each row is chained together with a SHA256 hash chain (`prevHash`/`rowHash`), with no UPDATE or DELETE, and intentionally no foreign key on `actorId`/`targetId` so the chain does not break even if a user is deleted.
  * The `events` table (start/end time, registration open/close window, total/Thai/international/Walk-in quotas, target group, allowed roles, and multiple posters `imageUrls`), `attendance` (registration/check-in records with a unique index preventing duplicate registration), `houses` (house scores), and `scoreHistory` (history of score adjustments and house bonuses).
  * The `forms` and `formSubmissions` tables for the KAS form system — storing form type (`formType`), section/branching question structure (`questions` v2), open/close time (`opensAt`/`closesAt`), award status (`isAwarded`), and a unique index (form_id, student_id) preventing duplicate submission to farm scores.

#### 📂 [src/db/index.ts](file:///E:/OnlyWork/SMO Meetings/Web/activecamt/src/db/index.ts)
* **Main responsibility:** creates the connection to the PostgreSQL database.
* **Internal logic:**
  * Reads `DATABASE_URL` from env (.env).
  * Uses the `postgres` library together with Drizzle ORM.
  * **[PERFORMANCE] connection pool:** manages connections as a singleton to prevent exceeding the max connection limit when many students use the system simultaneously.

---

### 3.2 Client-Side Pages & Forms

#### 📂 [src/app/onboarding/page.tsx](file:///E:/OnlyWork/SMO Meetings/Web/activecamt/src/app/onboarding/page.tsx)
* **Main responsibility:** the new student's first-time data entry page, split into a 3-part form, supporting 4 languages.
* **Internal logic:**
  * **input constraints:**
    * Student ID: regex allowing only digits `0-9`, limited to 9 digits in length.
    * Phone number and emergency number: accept only digits, 10 digits long.
    * Dietary restrictions: if "Other" is selected, a detail input appears via state (`dietaryRestrictionsOther`).
  * **[NEW] 5MB client-side image-size check:** in `handleImageUpload`, reads `file.size` before sending to the server; if it exceeds `5 * 1024 * 1024` bytes, the upload is canceled and the error `t.fileTooLarge` is shown immediately.

#### 📂 [src/app/dashboard/profile/page.tsx](file:///E:/OnlyWork/SMO Meetings/Web/activecamt/src/app/dashboard/profile/page.tsx)
* **Main responsibility:** the page for editing a student's personal information and health history.
* **Internal logic:**
  * Loads existing health data and phone number into the form for editing.
  * Locks the student ID (cannot be edited after registration, for the security of the permission system).
  * Validates that the mobile and emergency numbers accept only 10 digits.
  * **[NEW] 5MB upload guard + auto-clear error:** prevents uploading files over 5MB by checking the size and warning beforehand, and clears the previous error when a new file is selected.

#### 📂 [src/app/dashboard/history/page.tsx](file:///E:/OnlyWork/SMO Meetings/Web/activecamt/src/app/dashboard/history/page.tsx)
* **Main responsibility:** the page aggregating a student's activity history, with an evaluation-form system.
* **Internal logic:**
  * **[FIX] epoch date validation:** prevents showing the date 1 January 1970 when not yet checked in (check_in_time is null), by displaying the event's open time instead.
  * **[NEW] attendance warning modal:** when the "Submit evaluation" button is pressed (icon changed to `<ClipboardList />` to avoid confusion), the system checks check-in status first; if no real scan record is found, it locks the form from being opened/submitted and pops up a red modal explaining the reason in the student's language.
  * **dynamic form fields renderer:** renders all question types defined by the admin — long text, star rating, single choice, and multi-select checkbox.
  * **[NEW] full-screen scrollable evaluation form on mobile:** a form with star ratings scrolls full-screen, the form header is more compact on mobile, and the scroll position resets on each new section.
  * **[NAV] Event History tab promoted:** the Event History tab is moved higher in the navigation for easier discovery, with iPad/tablet-friendly breakpoints.

---

### 3.3 Backend API Route Handlers

#### 📂 [src/app/api/upload/route.ts](file:///E:/OnlyWork/SMO Meetings/Web/activecamt/src/app/api/upload/route.ts)
* **Main responsibility:** validates and stores event poster images and profile images to disk at `/public/uploads/`.
* **Internal logic:**
  * Checks the NextAuth session to prevent outsiders/bots from calling it.
  * Validates MIME type and file extension (`.jpg`, `.png`, `.webp`, etc.) to prevent stored XSS.
  * **[NEW — server-side limit] block files over 5MB:**
    ```typescript
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File size exceeds the 5MB limit." }, { status: 400 });
    }
    ```
    If someone bypasses the client-side validation with a large raw file, the server cancels writing the file and responds with 400 Bad Request.

#### 📂 [src/app/api/admin/users/[id]/route.ts](file:///E:/OnlyWork/SMO Meetings/Web/activecamt/src/app/api/admin/users/[id]/route.ts)
* **Main responsibility:** the admin-side route for editing an individual user (called from the Manage User modal on the admin students page).
* **Internal logic:**
  * **[NEW] supports the prefix field:** `PATCH /api/admin/users/[id]` accepts, saves, and audits the edited `prefix` value (a native select beside the full name).
  * **[UI] mobile-ready Manage User modal:** reworked to a flex column + `maxHeight: 90vh` + a scrollable body so it no longer overflows/clips on mobile, with `clamp()`-based padding/radius and a non-collapsing header/footer.

#### 📂 [src/app/api/realtime/route.ts](file:///E:/OnlyWork/SMO Meetings/Web/activecamt/src/app/api/realtime/route.ts)
* **Main responsibility:** provides persistent Server-Sent Events (SSE), streaming changes to the user's browser.
* **Internal logic:**
  * Streams via keep-alive and sends a heartbeat ping every 15 seconds to prevent proxies from cutting the connection.
  * **[CRITICAL SECURITY] PDPA filter (permission-based data filtering):**
    * If **admin**, receives all activity data (names of those checking in, admin history, score listings).
    * If **student**, the filter strips out other people's check-in names and all detailed data, leaving only the house's accumulated score and a signal that there is a new activity, per PDPA requirements.

#### 📂 [src/lib/realtime-emitter.ts](file:///E:/OnlyWork/SMO Meetings/Web/activecamt/src/lib/realtime-emitter.ts)
* **Main responsibility:** a broker that relays messages across processes (cross-process IPC) to work around the memory-isolation limit of Next.js worker threads.
* **Internal logic:**
  * Next.js isolates processes, so a normal in-memory event emitter cannot send across them.
  * This file fixes that by writing short messages to disk at `/scratch/realtime-events/` and using `fs.watch` to monitor; when it finds a new file it pushes it into SSE and immediately unlinks the file.

---

### 3.4 Internal Business Logic Layer (Modules & Services Layer)

#### 📂 [src/modules/audit/audit.service.ts](file:///E:/OnlyWork/SMO Meetings/Web/activecamt/src/modules/audit/audit.service.ts)
* **Main responsibility:** the service that writes logs of various actions for security and for display on the admin audit page.
* **Internal logic:**
  * `logAction` takes the event detail, IP address, and actor name, then writes to the `auditLogs` table.
  * Blocks UPDATE and DELETE so the log is immutable.

#### 📂 [src/modules/users/users.service.ts](file:///E:/OnlyWork/SMO Meetings/Web/activecamt/src/modules/users/users.service.ts)
* **Main responsibility:** manages user data, roles, and access to personal health data.
* **Internal logic:**
  * Fetches a student's personal data for display on the search page.
  * Encrypts/decrypts the health-data fields when writing or reading.
  * **[CRITICAL — PDPA] signal/detail split for medical-data access:** registration staff see only a *signal* that a medical condition exists (a translated, categorized bullet list), not the *detail* — the detail and meds-check detail (`medsCheckOption`) are admin-only, while emergency contacts remain visible to the caretaker roles as before.
  * **[FIX] closed a meds-check leak:** the meds-check badge previously hinted at who had a medical condition; that signal is now stripped from non-admin layers.

#### 📂 [src/modules/houses/houses.service.ts](file:///E:/OnlyWork/SMO Meetings/Web/activecamt/src/modules/houses/houses.service.ts)
* **Main responsibility:** the service that calculates house scores and updates the leaderboard.
* **Internal logic:**
  * Calculates house rankings in real time and sends an IPC signal to SSE when a house score updates.

#### 📂 [src/modules/events/scanner.service.ts](file:///E:/OnlyWork/SMO Meetings/Web/activecamt/src/modules/events/scanner.service.ts)
* **Main responsibility:** the logic for scanning and recording activity attendance time.
* **Internal logic:**
  * Validates a student's dynamic QR token.
  * Prevents duplicate scans, records the time, and sends an IPC signal to SSE to update the check-in result to the admin's browser instantly.

---

### 3.5 KAS Multi-Form System

* **Main files:** `src/lib/forms/form-schema.ts` (core logic), `src/lib/access/form-access.ts` (form access control), `src/app/api/admin/forms/route.ts` (admin-side form management), `src/app/api/events/[id]/form/route.ts` (student-side answer submission).
* **Main responsibility:** create and process multiple form sets per event, with a Google Forms-style UI, supporting both pre- and post-activity evaluation.
* **Internal logic:**
  * **4 form types:** `K_pre` (pre-test), `K_post` (post-test), `A` (attitude), `S` (skill — filled in by an evaluator).
  * **Question types:** text, rating (stars), choice (single select), multiple (multi-select).
  * **Sections and branching:** v2 question structure `{version: 2, sections: []}` supporting jumps across sections based on answers (`__next__`, `__submit__`, or a section id) and conditional show/hide of questions (`visibleIf`), with a guard against infinite loops.
  * **Quiz scoring:** `computeScore()` scores only questions marked `graded` and only sections the student actually traversed (respecting the branching path).
  * **[NEW] automatic close and award by time:** form status is derived from `opensAt`/`closesAt` (open, upcoming, closed, awarded) together with an `isActive` switch that can be manually overridden. Once `isAwarded` is true, the form is permanently locked; students can still view their score but cannot resubmit.
  * **Access control:** form `S` is restricted by `assignedRoles`/`assignedUserIds`; forms `K_post`/`A`/`S` require `attended` status before they can be accessed.
  * **Export:** export answers and scores as XLSX.

### 3.6 Secure QR & Check-in

* **Main files:** `src/lib/qr/qr-token.ts` (generate/verify token), `src/modules/users/users.service.ts` (find student from token), `src/modules/events/scanner.service.ts` (scan logic and quota enforcement).
* **Internal logic:**
  * **[SECURITY] TOTP-style HMAC QR token:** format `{userId}.{exp}.{signature}`, where the signature is the HMAC-SHA256 of the payload using `AUTH_SECRET`, rotating the window every 5 minutes (with a per-user offset spread to prevent simultaneous refreshes from overwhelming the server), a 30-second grace period, and a timing-safe check to prevent side-channel attacks; there is a fallback to a static UUID for manual check-in.
  * **Two-step check-in (Scan → Confirm):** the Scan step shows the student's health-alert info for the officer to review first, then Confirm records the actual check-in time, updating atomically only while the status is still `registered`.
  * **Atomic quota enforcement:** both advance registration and Walk-in check-in use a row lock (`FOR UPDATE`) to prevent race conditions (TOCTOU) — Walk-in checks both the total capacity (`quota + quotaWalkIn`) and the Walk-in sub-ceiling at the same time.
  * **[NEW] registration-cancellation lock:** a registration can no longer be cancelled after the close time, and a confirmation modal appears before un-registering to prevent accidental taps.

### 3.7 Tamper-Evident Audit Trail

* **Main file:** `src/modules/audit/audit.service.ts`
* **Internal logic:**
  * Each row is chained into a hash chain: storing `prevHash` (hash of the previous row) and `rowHash` (hash of itself), with a fixed field order `[id, timestamp, actorId, targetId, action, ipAddress, prevHash]`.
  * Uses PostgreSQL advisory lock (`pg_advisory_xact_lock`) to serialize writes and prevent chain collisions.
  * `verifyChainIntegrity()` recomputes the hash of the entire chain to find the first point that was tampered with.
  * **[NEW] expanded logging scope:** covers editing/changing role/deleting a user, editing a form, and admin login, with an index on `timestamp` to support server-side pagination of 30 records/page.

### 3.8 Leaderboard & Individual Standings

* **Main files:** `src/modules/houses/houses.service.ts`, `src/app/api/houses/individual/route.ts`, `src/app/api/houses/individual/me/route.ts`, `src/app/dashboard/houses/page.tsx`
* **Internal logic:**
  * Ranks houses by `points DESC` and individuals by `points DESC, id ASC` (breaking ties by id for a deterministic result), only for those who have fully completed their profile.
  * **[NEW] find own rank:** the `/api/houses/individual/me` endpoint returns `{points, rank, total}` of the current user as soon as the session is ready, avoiding the delay on first render.
  * Anyone with a score ≤ 0 returns `rank: null`, displayed as "Unranked".
  * **[NEW] no-score activities are not attached to a house:** activities with no attendees / 0 points are no longer attached to any house, but still appear in the feed marked as "no house".
  * **[NEW] house rosters + export:** adds house rosters (see who is in which house) and lets admins export an event's attendee list.
  * **[OPS] diagnostic/recovery scripts:** adds scripts to inspect and recover the activity feed for checking/repairing data when needed.

### 3.9 Multi-Poster & Event Presentation

* **Main files:** `src/app/dashboard/DashboardClient.tsx` (the `PosterCarousel` component), `src/app/admin/events/page.tsx` (add/remove/reorder posters).
* **Internal logic:**
  * One event can have multiple posters via `imageUrls` (the first image is the cover) and is still backward-compatible with the old single-image `imageUrl`.
  * **Swipeable carousel:** drag left/right to change image, with arrow buttons and position dots when there is more than 1 image.
  * **[NEW] full-screen zoom:** supports two-finger pinch, double-tap to toggle 1×↔2.5×, and wheel on desktop (zoom 1×–4×), with bounded pan and zoom reset when changing image.

---

## 4. System Testing Plan & Results

The results of the system functionality review are summarized as follows:

```
┌────────────────────────────────────────────────────────────────────────┐
│                         Security Limits Summary                          │
├───────────────────────────────────┬────────────────────────────────────┤
│           System Requirement       │           Verification Method      │
│ • Max profile image size           │ 5 MB (checked on both client & server) │
│ • Max event poster size            │ 5 MB (checked on both client & server) │
│ • Phone number length              │ 10 digits (auto-truncated, digits only) │
│ • Student ID length                │ 9 digits (auto-truncated, digits only)  │
│ • Student health data              │ field-level encryption + audit trail    │
│ • Login session (JWT) lifetime     │ 7 days (DB refresh every 2 minutes)     │
│ • QR token lifetime                │ 5 minutes + 30-second grace (HMAC-signed) │
│ • Audit chain integrity            │ SHA256 hash chain (tamper-detectable)   │
│ • Event quota                      │ total + Thai/international + Walk-in (atomic) │
└───────────────────────────────────┴───────────────────────────────────────┘
```

* **Server memory stability test:** from a production build running 11 workers processing pages, the system ran fast with no memory leak.
* **File-storage system security:** prevents disk-full conditions because the system cancels the write at the buffer level when it encounters a file over 5MB, saving storage and preventing disk-based DoS.

---

This SRS document fully describes the behavior of the files in the system, ready to be handed to the institution's IT department for further review.
