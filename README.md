# 🏠 ActiveCAMT — Real-Time Activity & Digital House Points Management Platform

ActiveCAMT is a next-generation web and mobile application designed to modernize student activity registration, secure attendance tracking, and house-based gamification systems for universities. 

Built using a state-of-the-art technical stack (**Next.js 16 + React 19 + Tailwind v4 + Drizzle ORM + NextAuth v5**), it replaces manual paperwork with high-speed **Secure QR Code Check-ins** and dynamic **Server-Sent Events (SSE) Real-Time updates** while ensuring full compliance with personal data protection laws (**PDPA**).

---

## 📄 แผนงานเชิงกลยุทธ์และเอกสารเทคนิค (Strategic & Funding Documents)

To help you pitch this project to university deans, other faculties, or academic committees to request funding, we have provided comprehensive, professionally formatted documents:

* **[เอกสารข้อเสนอโครงการเพื่อขอทุนสนับสนุน (Project Funding Proposal) 📄](./docs/wiki/camt-fun/project_proposal_th.md)**  
  *Detailed strategic pitch outlining deans' pain points, the gamification value proposition (House Points system), expected student engagement KPIs, and maximum infrastructure cost-efficiency (~500 - 1,000 Baht/month).*
* **[เอกสารข้อกำหนดความต้องการทางซอฟต์แวร์ (Software Requirements Specification - SRS) 🛡️](./docs/software/00-srs-th.md)**  
  *Rigorous software engineering specification detailing database schemas, NextAuth session updates, strict validation rules (such as 10-digit phone filtering, 9-digit Student ID, and 5MB image upload checks), encrypted medical data handling, and immutable administrative audit trails.*

---

## ✨ คุณสมบัติเด่นของระบบ (Core Features)

* **🛡️ 5MB Profile Picture & Poster Guard:** Strict server-side (`/api/upload`) and client-side image size validations capped at **5MB** to protect local server SSD storage from abuse and ensure instant image loading.
* **📡 SSE Real-Time Leaderboards:** persistent Server-Sent Events (SSE) connections broadcast point allocations and event updates to students' dashboards in **sub-50ms latency** with strict PDPA data filters.
* **🔑 NextAuth Cookie Auto-Sync:** JWT session callback synchronization which dynamically updates browser cookies when onboarding or profiles are updated, letting students log in and proceed instantly without manual logouts.
* **📋 Dynamic Google-Forms-like Builder:** High-fidelity form designer for admins supporting long-text answers, 1-5 star ratings, radio buttons, and multiselect checkboxes. Intercepted by a **Warning Modal** preventing non-attended students from submitting feedback.
* **🛒 Integrated Merch Shop:** End-to-end store with per-variant stock/sizing, sale windows, PromptPay/QR payment with slip upload, and an admin approve/reject order flow — payment slips served only through an auth-guarded private bucket.
* **📢 Live Dashboard Announcements:** Editable rich-text announcement banner (bold, links, colors) managed by admins with live preview — no redeploy needed, sanitized against stored-XSS.
* **🔐 Layered Role-Based Access (incl. SMO scanner-only):** Access is gated across multiple layers (including `src/proxy.ts` middleware). The SMO role gets **scanner-only** admin access, routed straight to QR check-in without exposing the rest of the admin panel.
* **🩺 PDPA Medical Signal vs. Detail:** Registration staff see only the *signal* that a student has a medical condition (categorized, translated); the actual *detail* and emergency contacts are restricted to admins.
* **🔒 Immutable Audit Logs:** Append-only database logs tracking every admin access to sensitive student medical data, ensuring 100% university privacy compliance.

---

## 🗒️ บันทึกการอัปเดต (Changelog)

Per-period release notes (Thai, written for Discord + the team) live in the [`updates/`](./updates) folder:

* **[14–16 มิ.ย. 69](./updates/2026-06-14_to_06-16.md)** — PDPA medical signal/detail split, SMO scanner-only access, house rosters & feed fixes, registration cancellation lock, mobile fixes (eval form, Manage User modal + editable prefix).
* **[13–14 มิ.ย. 69](./updates/2026-06-13_to_06-14.md)** — Merch shop, live dashboard announcements, house mascot logos & Thai house names.
* **[11–12 มิ.ย. 69](./updates/2026-06-11_to_06-12.md)** — Earlier changes.

---

## 🛠️ สถาปัตยกรรมและเทคโนโลยีหลัก (Technical Stack)

* **Core Framework:** Next.js 16.3.4 (App Router) + React 19.2 + TypeScript 5
* **Styling (CSS):** Tailwind CSS v4 (CSS-first config in `globals.css` via `@tailwindcss/postcss`)
* **Authentication:** NextAuth v5 (Beta) with `@auth/drizzle-adapter` (Google sign-in currently accepts Gmail and other Google accounts; CMU-domain enforcement is pending CMU IT support)
* **Database & ORM:** PostgreSQL + Drizzle ORM v0.45 (`drizzle-kit` v0.31)
* **Form Logic:** `react-hook-form` + `zod` v4 + `@hookform/resolvers`
* **QR Engine:** `html5-qrcode` (Scanner) + `qrcode.react` (Generator)

---

## 🚀 เริ่มต้นใช้งานและพัฒนา (Quickstart & Development)

### 1. การติดตั้ง (Installation)
Clone the repository and install all dependencies:
```bash
npm install
```

### 2. การกำหนดค่าระบบ (Environment Configuration)
Create a `.env` file in the root directory. You can copy the production template and fill out the values:
```bash
cp .env.production.example .env
```

The core required keys in `.env` are:
```env
# Database Connection (Required for Drizzle ORM)
DATABASE_URL="postgresql://activecamt_admin:securepassword@localhost:5432/activecamt_prod?sslmode=require"

# NextAuth v5 Configuration
AUTH_SECRET="your-super-secure-nextauth-secret"
AUTH_URL="http://localhost:3000/api/auth"

# Google OAuth Credentials (Get these from Google Cloud Console)
AUTH_GOOGLE_ID="your-google-oauth-client-id"
AUTH_GOOGLE_SECRET="your-google-oauth-client-secret"

# Self-Hosted PostgreSQL Configuration (Docker-compose database container)
POSTGRES_USER="activecamt_admin"
POSTGRES_PASSWORD="securepassword"
POSTGRES_DB="activecamt_prod"
```

> [!NOTE]
> For a detailed step-by-step tutorial on **"How to Get Each Key"** (generating secure session secrets and setting up Google OAuth Client Credentials specifically for your university domain), please refer directly to the **[Production Environment Variables Template Guide (.env.production.example)](./.env.production.example)**.


### 3. การจัดการฐานข้อมูล (Database Migrations & Operations)
Drizzle commands are configured to manage PostgreSQL schemas seamlessly:
```bash
# Push schema changes directly to DB (Development)
npm run db:push

# Generate SQL migration files from src/db/schema.ts
npm run db:generate

# Execute migration scripts (Production deployment)
npm run db:migrate

# Seed initial database events, houses, and default roles
npm run db:seed

# Open interactive Drizzle Studio UI
npm run db:studio
```

### 3.5 สคริปต์รันและทดสอบระบบบนเครื่อง Local (PowerShell Local Runner)
สำหรับผู้พัฒนาที่ใช้ระบบปฏิบัติการ Windows สามารถเรียกใช้งานสคริปต์ทดสอบและติดตั้งสิ่งจำเป็นแบบอัตโนมัติได้ผ่านคำสั่ง:
```powershell
.\run-local.ps1
```
คุณลักษณะเด่นของสคริปต์ `run-local.ps1`:
* **Auto Library Checks:** ตรวจสอบและติดตั้ง npm dependencies (รวมถึง `dotenv` และ `tsx`) ที่จำเป็นสำหรับการเชื่อมต่อและรันงานบน Local แบบอัตโนมัติ
* **Auto-generated Config:** สร้างและตั้งค่าไฟล์ `.env` พร้อมสุ่มรหัสความปลอดภัย (`AUTH_SECRET`, `POSTGRES_PASSWORD`) และสลับค่าพอร์ตให้ตรงกับ localhost ทันที
* **Flexible Launch Options:** เลือกรันเฉพาะฐานข้อมูลใน Docker, รันเฉพาะเว็บแอป Next.js, หรือรันแบบ Hybrid (ฐานข้อมูลใน Docker + เว็บเซิร์ฟเวอร์ด้านนอกผ่าน Node เพื่อความรวดเร็วในการ Hot-Reload) รวมถึงมีหน้าต่างควบคุม Drizzle Tools ครบถ้วน

### 4. รันเซิร์ฟเวอร์พัฒนา (Start Development Server)
```bash
npm run dev
# Server will start on http://localhost:3000
```

### 5. การรันบนโปรดักชัน (Production Build)
```bash
# Compile TypeScript and build optimized bundle
npm run build

# Start production server
npm run start
```

---

## 🐳 การใช้งานผ่าน Docker (Docker Containerization Blueprint)

To simplify server deployments and keep the codebase 100% unchanged, you can run the entire platform inside isolated Docker containers:

1. **Build and start containers in the background:**
   ```bash
   docker-compose up -d --build
   ```
2. **Access local server ports:**
   * Next.js web application is exposed on **`http://localhost:3000`**
   * Nginx reverse proxy handles dynamic request redirects and automated Let's Encrypt SSL certificates.

3. **Prune Docker build caches (Recommended monthly cron job):**
   ```bash
   docker system prune -a --volumes -f
   ```

---

## ⚖️ สัญญาอนุญาตและลิขสิทธิ์ (License)

This project is licensed under the **CMU CAMT Academic License** — developed for วิทยาลัยศิลปะ สื่อ และเทคโนโลยี มหาวิทยาลัยเชียงใหม่. All rights reserved.
