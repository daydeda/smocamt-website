/**
 * Single source of truth for whether THIS deployment is the retired "we've moved"
 * deployment — the old Vercel one, which now points at a stale Supabase DB and must
 * not run the real app (any write here would diverge from the live self-hosted data).
 *
 * Edge-safe ON PURPOSE: this reads only `process.env` and imports nothing, so the
 * edge proxy (`src/proxy.ts`), server components (`src/app/layout.tsx`), and the
 * auth module (`src/auth.ts`) can all share it without pulling in Node-only or DB
 * code. Keep it dependency-free — `auth.ts` consults it at module-load time to
 * decide whether to skip its production env guards, so anything it imports would run
 * on the retired deploy too and could re-introduce the crash this prevents.
 *
 * `VERCEL` is set automatically on every Vercel deployment; the self-hosted Docker
 * build never sets it. `NEXT_PUBLIC_SITE_MOVED` is a manual override: "1" forces the
 * notice on, "0" force-disables it (e.g. to temporarily run the real app on Vercel).
 */
export function isSiteMoved(): boolean {
  return (
    process.env.NEXT_PUBLIC_SITE_MOVED === "1" ||
    (process.env.VERCEL === "1" && process.env.NEXT_PUBLIC_SITE_MOVED !== "0")
  );
}
