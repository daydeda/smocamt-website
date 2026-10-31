---
name: verify
description: Runtime-verify a change in ActiveCAMT by driving the real app (admin UI / API) with a dev-bypass login against the local DB. Use before calling a change done.
model: sonnet
---

# Verify (ActiveCAMT)

Most changes here are admin-gated pages/APIs behind NextAuth Google OAuth, which you can't
drive headlessly. Use the built-in **Dev Bypass Login** credentials provider instead of
mocking anything.

## Setup
1. Bring up local DB: see `/db-local` skill (`docker start activecamt-db`, wait for
   `pg_isready`, `npx tsx --env-file=.env.local src/db/migrate.ts`).
2. Add `ENABLE_DEV_LOGIN=true` to `.env.local` (temporary — remove it again when done;
   it's gated to `NODE_ENV=development` + this flag + refuses a remote `DATABASE_URL`,
   but don't leave it committed).
3. Start the dev server: `npm run dev > /tmp/dev-server.log 2>&1 &`, poll
   `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` until it responds.

## Log in without Google OAuth
The dev bypass is a Credentials provider (`src/auth.ts`) that upserts a local user and
signs them in. Drive it via HTTP (works with `curl` using a cookie jar, or Playwright's
`request` context so cookies land in a browser context too):

```js
const csrfRes = await ctx.request.get('http://localhost:3000/api/auth/csrf');
const { csrfToken } = await csrfRes.json();
await ctx.request.post('http://localhost:3000/api/auth/callback/credentials', {
  form: {
    csrfToken,
    email: 'dev-superadmin@localhost.test',
    name: 'Dev Super Admin',
    role: 'super_admin',   // one of: student, smo, club_president, admin, super_admin
    callbackUrl: 'http://localhost:3000/admin/appeals',
  },
});
```
Then `ctx.newPage()` and `page.goto(...)` — the context already carries the session cookie.
(A raw `curl -c cookies.txt` jar also works for API-only checks; Playwright's
`addCookies` from a Netscape-format jar is fiddly — prefer driving the login through
`ctx.request` in the same browser context instead.)

## Screenshotting (Playwright not in package.json)
`npx playwright install chromium` downloads the browser but the `playwright` npm package
itself isn't a project dependency, so plain `import { chromium } from 'playwright'` fails
outside the project. Import it by absolute path from the npx cache instead:
```js
import { chromium } from '/Users/<you>/.npm/_npx/<hash>/node_modules/playwright/index.mjs';
```
Find `<hash>` with `find ~/.npm/_npx -maxdepth 4 -iname playwright -type d`.

## Gotchas hit in practice
- `docker exec activecamt-db psql ... <<'SQL'` **silently does nothing** without `-i` —
  `docker exec` needs `-i` to read stdin from a heredoc. Always `docker exec -i`.
- Button text probes with Playwright `has-text("Reject")` can accidentally match
  `"Rejected"` (substring match) — prefer exact selectors or scope to a specific card.
- No-show/appeals data model: `attendance.status = 'no_show'` rows are the durable
  per-event record (there's no separate strike-log table); `users.noShowCount` is just a
  counter that appeal-approval/reset zeroes without touching those attendance rows.

## Teardown
- Kill the dev server: `pkill -f "next dev --webpack"`.
- Remove `ENABLE_DEV_LOGIN=true` from `.env.local` again.
- Local DB seed data left behind is harmless (never prod) — fine to leave for next time.
