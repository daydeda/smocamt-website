# Plan: "Install the app and turn on notifications" pop-up

Status: built (`src/components/pwa/InstallPushPrompt.tsx`, logic in `src/lib/ui/install-prompt.ts`). Decisions from the open questions are recorded at the end.

## Goal

Get as many onboarded students as possible to (1) add ActiveCAMT to their home screen and
(2) turn on push notifications, so they receive form reminders, new-event pushes and
waitlist seats without having to go looking for the setting on their Profile page.

## What browsers allow (why we can't truly "force" it)

| Step | iPhone (Safari) | Android (Chrome) | Desktop |
|---|---|---|---|
| Add to Home Screen | The user must tap Share, then "Add to Home Screen". No website can trigger it. | We can show Chrome's real install dialog (`beforeinstallprompt`), but only when the user taps our button. | Chrome/Edge: same install dialog. Safari: not needed. |
| Allow notifications | Only works **inside the installed app** (iOS 16.4+). In a normal Safari tab it fails silently. | Works in the browser or the installed app, after a tap. | Works after a tap. |

Two hard rules from the browsers:

- The permission prompt only appears after the user taps something. We can't show it automatically.
- If the user taps "Block" once, we can never ask again. Only they can undo it in the phone's settings.

A modal that blocks the whole app until they finish would lock out people who can't
finish: LINE's in-app browser, old iPhones (below iOS 16.4), desktop Safari, and anyone who
already tapped "Block". So the plan is a strong, repeated prompt, not a hard lock.

## Who sees it

All of these must be true:

1. Signed in and onboarding finished (`profileCompleted`). Every role, not only students.
2. Push isn't already on for **this device** (no existing push subscription).
3. The browser can do it at all (`isPushSupported()`, or iPhone not installed yet).
4. Notification permission isn't already "denied" (then we show a short help card instead, see below).
5. Not snoozed (see "How often").

Mounted once in the root layout (`src/app/layout.tsx`), so it shows on every page after login: dashboard, admin, battle, feedback, privacy and the public event page for a signed-in user. It never shows to signed-out visitors, before onboarding is finished, or on the two scanners (`/dashboard/scan`, `/admin/scanner`). It shows as soon as the page has loaded (no delay) and sits on top of any other dialog, such as the 3-month profile check-in. The check-in stays underneath and is still there after the student answers the install pop-up.

## What the user sees

The pop-up picks one of four screens based on the device:

**A. iPhone, not installed yet (opened in Safari)**
- Title: "Get ActiveCAMT on your home screen"
- Why: reminders before forms close, new events you can join, waitlist seats.
- Three illustrated steps: tap Share (icon), tap "Add to Home Screen", open ActiveCAMT from the
  home screen.
- Note: "Notifications only work from the home-screen app on iPhone."
- Buttons: "Done, I added it" (closes, re-checks next open) and "Not now".

**B. iPhone opened in another app's browser (LINE, Facebook, Instagram)**
- These can't install or receive pushes. Show "Open in Safari to install" with a copy-link
  button.

**C. Android/desktop Chrome, not installed**
- Button "Install app" opens Chrome's own install dialog.
- After installing (or if they skip install), go straight to screen D, since Android can
  receive pushes in the browser too.

**D. Installed (or Android/desktop), notifications off**
- Title: "Turn on notifications"
- One big button: "Turn on notifications". It calls the existing `enablePushNotifications()`,
  so the system prompt appears right after the tap.
- On success: a short "You're all set" and the pop-up closes for good on this device.

**E. Notifications blocked ("denied")**
- No prompt is possible. Show a short card with how to re-allow them in phone settings
  (iPhone: Settings > Notifications > ActiveCAMT; Android: site settings), plus "Not now".

## How often

- First shown on the first dashboard visit after onboarding.
- "Not now" snoozes it for 3 days.
- "Don't ask again" appears from the third time onward, and hides it for 14 days.
- Turning push on, or the device already having a subscription, hides it permanently on that device.
- Stored in `localStorage` per device (it's a per-device question: a student may have push on
  their phone but not their laptop). No database change and no migration.

## Languages

Student-facing, so all four locales: EN, TH, MM, CN.

## Build outline (for later, after this plan is approved)

1. `src/lib/ui/install-prompt.ts` (pure): picks screen A to E from user agent, standalone,
   permission state, subscription and snooze data. Unit-tested with Vitest.
2. `src/components/pwa/InstallPushPrompt.tsx`: the modal. Reuses `enablePushNotifications()`,
   `isPushSupported()` and the standalone check from `pwa-standalone.ts`. Captures
   `beforeinstallprompt` for the Android install button.
3. Mount it in the dashboard layout only.
4. Step illustrations for iPhone (simple inline SVG icons, light and dark mode).
5. i18n keys in en/th/mm/cn.
6. Track nothing new on the server. Success shows up as new rows in `push_subscriptions`.

No schema change, no migration, no change to access control or PDPA data.

## Decisions (answered 2026-10-23)

1. Snooze: 3 days after "Not now", 14 days after "Don't ask again" (the shorter of the two options offered, since the goal is to get people subscribed).
2. All roles see it, staff included.
3. "Dashboard only" meant the single home page `/dashboard`. "Any signed-in page" means every page under `/dashboard` (events, history, shop, houses, profile and so on). Chosen: every `/dashboard` page except the scanner, so someone who opens the app from a push link straight into an event or the shop still sees it. Admin pages are left out because staff use them on desktops while working.
4. No screenshots supplied, so the iPhone steps are drawn as inline SVG (Safari toolbar with the Share button, the share sheet row "Add to Home Screen", and a home screen with the ActiveCAMT icon). They follow light and dark mode and the row label is translated.

## Testing

### What blocks a plain localhost run

- `src/components/PWARegister.tsx` registers `public/sw.js` only in production builds. Without a service worker, `enablePushNotifications()` waits forever on `navigator.serviceWorker.ready`, and Chrome never fires `beforeinstallprompt`.
- Service workers, install and push need a secure origin. `http://localhost` counts as secure on the laptop itself, but a phone reaching the laptop by LAN IP does not, so a phone needs real HTTPS.
- Install state comes from `display-mode: standalone` / `navigator.standalone`, which only change when the app is really opened from the home screen.
- A production build (`next build && next start`) has no Dev Bypass Login, and Google sign-in rejects a random tunnel URL. So phone testing runs the **dev server** with the service worker switched on, behind an HTTPS tunnel.

### Dev-only switches (no effect on prod)

| Switch | Where | What it does |
|---|---|---|
| `?pwa-preview=<name>` | any page after login, dev server only (the param is lost if the page redirects, e.g. `/admin`) | Fakes the device: `ios-safari`, `ios-installed`, `ipad-safari`, `ipad-installed`, `android-chrome`, `android-installed`, `android-tablet`, `mac-safari`, `in-app`, `denied`, `subscribed`. Ignores and never writes the snooze, fakes "Turn on" success, shows a "DEV PREVIEW" label. Stripped from production builds. |
| `NEXT_PUBLIC_ENABLE_SW_IN_DEV=true` | `.env.local` | Registers the service worker on the dev server, so the real install and permission flow runs. Read at build time; the prod image never sets it. |
| `*.trycloudflare.com` in `allowedDevOrigins` | `next.config.ts` | Lets a phone load the dev server through a Cloudflare quick tunnel. Dev server only. |

### 1. Laptop, every screen (about 5 minutes)

1. `docker start activecamt-db-local`, then `npm run dev`. `ENABLE_DEV_LOGIN=true` must be in `.env.local`.
2. Open `http://localhost:3000/login` and use the dev login.
3. Open each URL and wait 3 seconds:

| URL | Expected |
|---|---|
| `/dashboard/history?pwa-preview=ios-safari` | "Add ActiveCAMT to your home screen" with the 3 drawn steps |
| `/dashboard/history?pwa-preview=ios-installed` | "Turn on notifications" |
| `/dashboard/history?pwa-preview=android-chrome` | "Install the ActiveCAMT app". Install app, then Turn on, should end at "You're all set" |
| `/dashboard/history?pwa-preview=android-installed` | "Turn on notifications" |
| `/dashboard/history?pwa-preview=in-app` | "Open in your browser first" with Copy link |
| `/dashboard/history?pwa-preview=denied` | "Notifications are blocked" help card |
| `/dashboard/history?pwa-preview=subscribed` | No pop-up; the console says "nothing to show" |

4. Switch the language and dark mode from the nav and repeat any screen.
5. Real flow on the laptop: add `NEXT_PUBLIC_ENABLE_SW_IN_DEV=true` to `.env.local`, restart `npm run dev`, open `/dashboard` (no preview param) in Chrome, tap "Turn on notifications", and allow. Sign in as `admin` to use the test panel on Profile and send yourself a push.
6. Snooze: "Not now" saves `activecamt.installPrompt` in DevTools > Application > Local Storage. Delete that key to see the pop-up again.

### 2. Real iPhone and Android (about 20 minutes)

One-time setup:
1. `brew install cloudflared`.
2. In `.env.local`: `ENABLE_DEV_LOGIN=true` and `NEXT_PUBLIC_ENABLE_SW_IN_DEV=true`. The VAPID keys are already there.
3. `docker start activecamt-db-local`, then `npm run dev`.
4. In a second terminal: `cloudflared tunnel --url http://localhost:3000`. Copy the `https://<random>.trycloudflare.com` address it prints. Keep the tunnel running for the whole test, because a new run gives a new address and the home-screen app would point at the old one.

**Warning:** while the tunnel runs, anyone with that address can use the dev login, including as super_admin, against your local database. Only run it while testing, make sure the local DB holds no real student data, and stop it with Ctrl+C when finished.

iPhone (iOS 16.4 or newer):
1. In Safari open `<tunnel>/login`, dev login with role **admin** (admin unlocks the push test panel).
2. On `/dashboard`, wait 3 seconds. Expected: "Add ActiveCAMT to your home screen".
3. Follow the steps: Share (or ••• then Share), Add to Home Screen, Add.
4. Open the new icon. Sign in again if asked; the home-screen app may not share Safari's cookies.
5. Wait 3 seconds. Expected: "Turn on notifications". Tap it, then Allow. Expected: "You're all set".
6. Profile > Test notifications (admin) > Send test. Expected: a notification within seconds, also with the app closed.
7. Close and reopen the app. Expected: no pop-up.
8. Settings > Notifications > ActiveCAMT > turn off Allow Notifications, then reopen the app. Expected: the "Notifications are blocked" card.

Android (Chrome):
1. Open `<tunnel>/login`, dev login as **admin**.
2. On `/dashboard`, wait 3 seconds. Expected: "Install the ActiveCAMT app". If Chrome hasn't offered install yet, you get "Turn on notifications" directly. That is also correct.
3. Install app, then Chrome's dialog, then Install. Expected: the pop-up moves to "Turn on notifications". Tap it, then Allow, then "You're all set".
4. Profile > Send test. Expected: a notification.
5. Open the installed app from the home screen. Expected: no pop-up.
6. Chrome > site settings for the tunnel address > Notifications: Block, then reload. Expected: the help card.

Both phones, in-app browser: send yourself the tunnel link in LINE and open it inside LINE. Expected: "Open in your browser first" and a working Copy link.

Reset a phone between runs: Not now snoozes for 3 days. Clear the site data, or open the next tunnel address (a new address starts clean).

### 3. Clean up

- Ctrl+C the tunnel and the dev server.
- Remove the test icon from each phone's home screen.
- On the laptop: DevTools > Application > Service workers > Unregister (the dev worker would otherwise stay registered for localhost).
- Optionally remove `NEXT_PUBLIC_ENABLE_SW_IN_DEV` from `.env.local`.

### Interaction with the 3-month profile check-in

The check-in modal already exists (`ProfileReviewGate`, v2.23.0) on the dashboard home and the profile page. To reproduce locally: `docker exec -i activecamt-db-local psql -U postgres -d activecamt -c "UPDATE users SET profile_reviewed_at = NULL WHERE email = '<dev email>';"` and open `/dashboard`.

Decision (2026-10-23): the install pop-up shows immediately and covers the check-in (it uses a higher layer, `zIndex: 2100`, against 2000 for the other dialogs). Measured locally with the check-in due: the install pop-up appeared first at about 1 to 2 seconds, even when `/api/profile` was held back 4 seconds, the check-in stayed underneath, and after "Not now" the check-in was still open. The cost is that a student sees the install pop-up before a check-in that is due; the check-in is never skipped.

### Device coverage

| Device | Screen | How it is told apart |
|---|---|---|
| iPhone, iPod | Add to Home Screen steps, then "Turn on notifications" inside the installed app | `iPhone` / `iPod` in the user agent |
| iPad, default settings | Same as iPhone | iPadOS sends a "Macintosh" user agent, so a Mac with `navigator.maxTouchPoints` above 1 is treated as an iPad (no Mac has a touch screen) |
| iPad, "Request Mobile Website" | Same as iPhone | `iPad` in the user agent |
| Mac Safari 16+, Windows/Linux/ChromeOS (Chrome, Edge, Firefox) | "Turn on notifications" in the tab. Chrome and Edge may first offer "Install app" | Not iOS; push works without installing |
| Android phone or tablet, Chrome or Samsung Internet | "Install app" when the browser offers it, otherwise "Turn on notifications" | Not iOS. Tablets use the same path as phones |
| LINE, Facebook, Instagram browsers | "Open in your browser first" | Known in-app browser names in the user agent |
| Old browsers without push | Nothing shown | `PushManager` missing |

Touch-screen Windows laptops and Chromebooks are not mistaken for iPads, since only a Macintosh user agent with touch is.
