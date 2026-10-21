import { createHash, timingSafeEqual } from "crypto";

// Constant-time comparison; hashing first equalizes lengths so even the
// length of the secret doesn't leak through response timing. Mirrors
// songsue's own src/lib/integration-auth.ts (same shared secret, both
// directions of the cross-app sync use it).
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest()
  );
}

// Bearer-secret check for the Songsue → ActiveCAMT check-in sync endpoint
// (src/app/api/integrations/songsue/**). Reuses ACTIVECAMT_SYNC_SECRET — the
// same shared secret already configured on both apps for the existing
// ActiveCAMT → Songsue direction (src/lib/songsue-sync.ts). Fails closed if
// the env var is unset, so a misconfigured deploy rejects every request
// rather than accepting everything.
export function isAuthorizedSongsueSync(req: Request): boolean {
  const authHeader = req.headers.get("authorization") ?? "";
  const secret = process.env.ACTIVECAMT_SYNC_SECRET;
  return Boolean(secret) && safeEqual(authHeader, `Bearer ${secret}`);
}
