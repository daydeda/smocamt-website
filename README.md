<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:7c3aed,100:ec4899&height=200&section=header&text=ActiveCAMT&fontSize=64&fontColor=ffffff&animation=fadeIn&fontAlignY=38&desc=Activities%20%C2%B7%20QR%20Attendance%20%C2%B7%20House%20Points&descAlignY=60&descSize=18" alt="ActiveCAMT" width="100%" />

<img src="./public/smocamt-logo.png" alt="SMO CAMT logo" height="96" />

<a href="https://git.io/typing-svg"><img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=22&duration=3200&pause=900&color=A855F7&center=true&vCenter=true&width=640&lines=Scan+a+QR.+Earn+points.+Win+for+your+house.;Built+by+students%2C+for+students+at+CAMT+CMU.;Fast+check-ins.+Fair+scoring.+Private+by+design." alt="Typing animation" /></a>

[![English](https://img.shields.io/badge/lang-English-7c3aed?style=for-the-badge)](./README.md)
[![ภาษาไทย](https://img.shields.io/badge/lang-%E0%B8%A0%E0%B8%B2%E0%B8%A9%E0%B8%B2%E0%B9%84%E0%B8%97%E0%B8%A2-ec4899?style=for-the-badge)](./README.th.md)

![Version](https://img.shields.io/badge/version-2.22.0-7c3aed?style=flat-square)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-38bdf8?style=flat-square&logo=tailwindcss&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Drizzle-336791?style=flat-square&logo=postgresql&logoColor=white)
![PDPA](https://img.shields.io/badge/PDPA-aware-16a34a?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-f59e0b?style=flat-square)

</div>

---

## 👋 What is ActiveCAMT?

ActiveCAMT is the student activity platform of the **College of Arts, Media and Technology (CAMT), Chiang Mai University**. It replaces paper sign-in sheets with a fast, tamper-resistant **QR check-in**, and turns participation into a friendly competition between the college's **houses** through a live **house-points** leaderboard.

Students browse and register for events, show a QR code at the door, and watch their house climb the board. Staff run events, scan attendance, collect feedback and manage a merch shop, all from one place, with student privacy ([PDPA](https://pdpc.or.th/)) treated as a hard requirement rather than an afterthought.

> [!NOTE]
> Sign-in uses Google OAuth. Restricting it to `@cmu.ac.th` accounts is pending CMU IT, so today any Google account can sign in. Treat "logged in" as *an account*, not as *a verified CMU student*.

## ✨ Highlights

| | Feature | What it does |
|---|---|---|
| 📲 | **QR attendance** | Short-lived, signed QR tokens for students; staff scan with the in-app scanner. Multi-day events and partial attendance are supported. |
| 🏆 | **House points & leaderboards** | Points flow to a student's house and to individual totals, with strikes, appeals and clear scoring rules. |
| 🗓️ | **Events & calendar** | Registration limits by major, recurring events, a monthly calendar and a subscribable `.ics` feed. |
| 📝 | **Form builder** | A Google-Forms-style designer (ratings, choices, long text, file upload) for feedback and evaluations. |
| 🛒 | **Merch shop** | Per-variant stock, PromptPay/QR payment with slip upload, approve/reject flow, and a marketplace for approved sellers. |
| 🎮 | **Mini-game battles** | Head-to-head rooms (starting with OX) that you join by QR or room code. |
| 🔔 | **Notifications** | In-app toasts and web-push for check-ins, scores and announcements. |
| 📢 | **Announcements** | A rich-text banner that admins edit live, sanitised against stored XSS. |
| 📮 | **Feedback & complaints** | Rate-limited channel for students to reach the student association. |
| 📱 | **Installable PWA** | Works on phones like an app, with English, Thai, Burmese and Chinese for student pages. |

### 🔐 Privacy and security, taken seriously

- **Layered access control.** Roles (`student`, `smo`, `anusmo`, `registration`, `organizer`, `admin`, `super_admin`, plus club/major presidents and shop sellers) are enforced in the edge proxy, the admin layout *and* every API route. The UI is never the only gate.
- **Medical data is need-to-know.** Registration staff only see *that* a student has a condition; the detail is limited to admins and, for their own club/major/events, presidents, with emergency-contact names stripped.
- **Append-only audit log.** Every access to sensitive data is recorded in a hash-chained log.
- **Uploads are guarded.** Images are capped at 5 MB on both client and server, and payment slips live in a private, auth-guarded bucket.

## 🧰 Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript 5 |
| Styling | Tailwind CSS v4 (CSS-first config in `globals.css`), Framer Motion |
| Auth | NextAuth v5 (beta) with `@auth/drizzle-adapter`, Google OAuth |
| Database | PostgreSQL with Drizzle ORM and `drizzle-kit` migrations |
| Forms & validation | React Hook Form, Zod v4 |
| QR | `html5-qrcode` / `jsqr` (scan), `qrcode.react` (generate) |
| Testing | Vitest (pure-logic suite: access rules, QR tokens, audit chain, games) |
| Deployment | Docker + Postgres on the university server, managed with Portainer |

## 🚀 Getting started

**Prerequisites:** Node.js 20+, npm, and Docker (for a local Postgres).

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file and fill in the values
cp .env.production.example .env

# 3. Apply the schema, then (optionally) seed sample data
npm run db:push        # development only; use db:migrate for real deployments
npm run db:seed

# 4. Start the dev server on http://localhost:3000
npm run dev
```

The core variables in `.env`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/activecamt"
AUTH_SECRET="a-long-random-string"
AUTH_URL="http://localhost:3000/api/auth"
AUTH_GOOGLE_ID="your-google-oauth-client-id"
AUTH_GOOGLE_SECRET="your-google-oauth-client-secret"
```

> [!TIP]
> [`.env.production.example`](./.env.production.example) walks through how to obtain each key, including the Google OAuth client. On Windows, `./run-local.ps1` can set up `.env`, start Postgres in Docker and launch the app for you.

### Useful commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server on port 3000 |
| `npm run lint` | ESLint |
| `npm test` | Vitest (pure logic only) |
| `npm run build` / `npm start` | Production build and server |
| `npm run db:generate` | Generate SQL migrations from `src/db/schema.ts` |
| `npm run db:migrate` | Run migrations against the database in `.env` |
| `npm run db:studio` | Browse data with Drizzle Studio |

## 🐳 Deployment

Production runs as a Docker stack (app + Postgres) on the university server, managed through Portainer. Locally you can bring the whole thing up with:

```bash
docker-compose up -d --build
```

For the server setup, see [`docker-stack.yml`](./docker-stack.yml), [`university_server_deployment_guide.md`](./docs/deployment/university_server_deployment_guide.md) and [`production_deployment_architecture.md`](./docs/deployment/production_deployment_architecture.md).

> [!WARNING]
> Nothing migrates automatically on container start. Run `npm run db:migrate:container` from the Portainer console of the app container **before** deploying code that reads a new or changed column. Migrations must be idempotent and non-destructive.

## 🗂️ Project layout

```text
src/
├─ app/          Next.js routes: dashboard/, battle/, admin/, api/ ...
├─ modules/      Domain services (events, houses, clubs, audit, ...)
├─ lib/          Access predicates, QR signing, PDPA helpers, i18n, games/
├─ components/   Shared UI (admin/, layout/, home/, ui/)
├─ db/           schema.ts (source of truth), migrate, seed, guards
└─ proxy.ts      Edge middleware (first line of access control)
drizzle/         Generated SQL migrations
docs/            SRS, design notes, game design docs, wiki
updates/         Per-period changelogs (Thai)
```

## 📚 Documentation

- 📄 [Project funding proposal (TH)](./docs/wiki/camt-fun/project_proposal_th.md)
- 🛡️ Software requirements: [SRS (TH)](./docs/software/00-srs-th.md) · [SRS (EN)](./docs/software/00-srs-en.md)
- 🧭 [Docs index](./docs/index.md) and [project wiki](./docs/wiki/wiki.md)
- 🗒️ [Changelogs](./updates) (written in Thai for the team)

> The SRS describes the original plan and can lag behind the code. When they disagree, `src/db/schema.ts` and the source are the truth.

## 🤝 Contributing

1. Branch off `main`. Never push directly to it.
2. Make your change, then run `npm test`, `npm run lint` and `npm run build`.
3. Open a pull request. Anything touching auth, admin routes or medical data gets an extra look at access control and audit logging.

## 📜 License

Released under the [MIT License](./LICENSE).

**Copyright © 2026 daydedaa and the Student Association of the College of Arts, Media and Technology (SMO CAMT), Chiang Mai University.**  
Software Engineer: [@daydedaa](https://github.com/daydedaa)  
Project concept by [@Nattapat23](https://github.com/Nattapat23).

<div align="center">

Made with 💜 by students of CAMT, Chiang Mai University

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:ec4899,100:7c3aed&height=100&section=footer" alt="" width="100%" />

</div>
