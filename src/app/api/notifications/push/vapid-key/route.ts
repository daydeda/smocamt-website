import { NextResponse } from "next/server";

// Public by design — a VAPID public key is meant to reach the browser (it's
// how the browser's push service verifies OUR sends, not a secret). Used by
// the client's subscribe flow and by the service worker's best-effort
// pushsubscriptionchange re-subscribe, which can't read server env directly.
export async function GET() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return NextResponse.json({ error: "Push notifications are not configured" }, { status: 503 });
  }
  return NextResponse.json({ publicKey }, { headers: { "Cache-Control": "no-store" } });
}
