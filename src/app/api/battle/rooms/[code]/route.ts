import { db } from "@/db";
import { gameRooms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { captureException } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";

// GET /api/battle/rooms/[code] - Inspect room status
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }


    const { code } = await params;
    const roomCode = code.toUpperCase();

    // Room codes are only 4 chars — throttle per user so a signed-in account
    // can't enumerate room codes. Durable Postgres-backed window.
    const limiter = await rateLimit(`battle:room-lookup:${session.user.id}`, 10, 60000);
    if (!limiter.success) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((limiter.resetTime - Date.now()) / 1000))) } }
      );
    }

    const room = await db.query.gameRooms.findFirst({
      where: (r, { eq }) => eq(r.roomCode, roomCode),
      with: {
        host: {
          columns: {
            id: true,
            name: true,
            nickname: true,
            houseId: true,
          }
        },
        guest: {
          columns: {
            id: true,
            name: true,
            nickname: true,
            houseId: true,
          }
        }
      }
    });

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    // Lazy evaluation for room expiration
    if (room.status === "waiting" && room.expiresAt < new Date()) {
      await db.update(gameRooms)
        .set({ status: "expired" })
        .where(eq(gameRooms.id, room.id));
      room.status = "expired";
    }

    return NextResponse.json({
      roomId: room.id,
      roomCode: room.roomCode,
      gameType: room.gameType,
      status: room.status,
      host: room.host,
      guest: room.guest,
      currentTurn: room.currentTurn,
      expiresAt: room.expiresAt,
    });

  } catch (error) {
    captureException(error, { route: "GET /api/battle/rooms/[code]" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
