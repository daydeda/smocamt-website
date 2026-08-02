import { auth } from "@/auth";
import { signCombinedQrToken } from "@/lib/qr-token";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { token, expiresAt } = signCombinedQrToken(session.user.id, session.user.email);
  const expiresIn = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return NextResponse.json({ token, expiresIn }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
