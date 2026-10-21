import { db } from "@/db";
import { gameRooms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { finalizeGameInDb } from "@/lib/games/stats-helper";
import { captureException } from "@/lib/util/logger";

// GET /api/battle/rooms/[code]/state - Get current game/board state + lazy evaluations
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
    const userId = session.user.id;

    // Player info is requested only until the client knows both players
    // (US-PERF-21e) — the steady-state poll is then a single indexed lookup.
    const includePlayers = new URL(req.url).searchParams.get("players") === "1";

    const room = await db.query.gameRooms.findFirst({
      where: (r, { eq }) => eq(r.roomCode, roomCode),
    });

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    if (room.hostId !== userId && room.guestId !== userId) {
      return NextResponse.json({ error: "Unauthorized to access this room" }, { status: 403 });
    }

    const now = new Date();

    // 1. Lazy evaluation of waiting room expiration
    if (room.status === "waiting" && room.expiresAt < now) {
      await db.update(gameRooms)
        .set({ status: "expired", updatedAt: now })
        .where(eq(gameRooms.id, room.id));
      room.status = "expired";
    }

    // 2. Lazy evaluation of turn timeout forfeit
    if (room.status === "active" && room.turnDeadline && room.turnDeadline < now) {
      const winnerId = room.currentTurn === 1 ? room.guestId : room.hostId;

      if (winnerId) {
        await db.transaction(async (tx) => {
          await finalizeGameInDb(tx, room, winnerId, "forfeit");
        });

        // Re-read from DB to get the actual finalized/current state (handles races)
        const updatedRoom = await db.query.gameRooms.findFirst({
          where: (r, { eq }) => eq(r.id, room.id),
        });
        if (updatedRoom) {
          Object.assign(room, updatedRoom);
        }
      }
    }

    // Fetch player info only when explicitly requested (US-PERF-21e)
    type PlayerInfo = { id: string; name: string | null; nickname: string | null; houseId: string | null };
    let host: PlayerInfo | null = null;
    let guest: PlayerInfo | null = null;
    if (includePlayers) {
      const playerIds = [room.hostId, room.guestId].filter((id): id is string => Boolean(id));
      const players = await db.query.users.findMany({
        where: (u, { inArray }) => inArray(u.id, playerIds),
        columns: { id: true, name: true, nickname: true, houseId: true },
      });
      host = players.find((p) => p.id === room.hostId) ?? null;
      guest = players.find((p) => p.id === room.guestId) ?? null;
    }

    return NextResponse.json({
      roomId: room.id,
      roomCode: room.roomCode,
      gameType: room.gameType,
      status: room.status,
      hostId: room.hostId,
      guestId: room.guestId,
      gameState: room.gameState,
      currentTurn: room.currentTurn,
      winnerId: room.winnerId,
      finishReason: room.finishReason,
      turnDeadline: room.turnDeadline,
      ...(includePlayers ? { host, guest } : {}),
    });

  } catch (error) {
    captureException(error, { route: "GET /api/battle/rooms/[code]/state" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
