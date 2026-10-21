import { sweepOrphanFormFiles } from "@/lib/forms/form-file-gc";
import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";

export const dynamic = "force-dynamic";

// Constant-time comparison; hashing first equalizes lengths so even the
// length of the secret doesn't leak through response timing.
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest()
  );
}

// GET /api/cron/gc-form-files — scheduled sweep that deletes orphaned form-upload
// files a crashed/closed browser never cleaned up. See src/lib/form-file-gc.ts for
// the (deliberately conservative) deletion rules. Triggered by Vercel cron.
export async function GET(req: Request) {
  // Verify cron secret to prevent unauthorized access. Fail CLOSED: if CRON_SECRET
  // is unset, reject everything rather than letting anyone trigger the job.
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || !safeEqual(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sweepOrphanFormFiles();
    return NextResponse.json({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("Cron gc-form-files error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
