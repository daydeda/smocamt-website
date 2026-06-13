import { db } from "@/db";
import { announcements } from "@/db/schema";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/announcement — public. Returns the singleton dashboard announcement
// ({ body, enabled }) read by the student dashboard banner. The table is treated
// as a singleton, so we read the most-recently-updated row. Returns null if none.
export async function GET() {
  try {
    const [row] = await db
      .select({ body: announcements.body, enabled: announcements.enabled })
      .from(announcements)
      .orderBy(desc(announcements.updatedAt))
      .limit(1);

    return NextResponse.json(row ?? null);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
