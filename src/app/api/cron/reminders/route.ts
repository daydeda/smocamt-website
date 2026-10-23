import { ReminderService } from "@/modules/notifications/reminders.service";
import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";

export const dynamic = "force-dynamic";

// Constant-time comparison; hashing first equalizes lengths.
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

// GET /api/cron/reminders — scheduled push reminders for forms that are about to close
// (24h and 1h before). Called every few minutes by scripts/cron-runner.mjs.
export async function GET(req: Request) {
  // Fail CLOSED: if CRON_SECRET is unset, reject everything.
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !safeEqual(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await ReminderService.runFormReminders();
    return NextResponse.json({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("Cron reminders error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
