import { db } from "@/db";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { finalizeGameInDb } from "@/lib/games/stats-helper";
import { getClientIp, AuditService } from "@/modules/audit/audit.service";
import { captureException } from "@/lib/logger";

// POST /api/battle/rooms/[code]/resign - Resign the game
export async function POST(
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

    const room = await db.query.gameRooms.findFirst({
      where: (r, { eq }) => eq(r.roomCode, roomCode),
    });

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    if (room.hostId !== userId && room.guestId !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    if (room.status !== "active") {
      return NextResponse.json({ error: "Game is not active" }, { status: 400 });
    }

    const winnerId = userId === room.hostId ? (room.guestId || null) : room.hostId;

    if (!winnerId) {
      return NextResponse.json({ error: "Cannot resign against non-existent player" }, { status: 400 });
    }

    await db.transaction(async (tx) => {
      await finalizeGameInDb(tx, room, winnerId, "resign");
    });

    const ip = getClientIp(req);
    await AuditService.logAction({
      actorId: userId,
      action: `Resigned from OX game room ${roomCode}`,
      ipAddress: ip,
    });

    // Return final state
    const freshRoom = await db.query.gameRooms.findFirst({
      where: (r, { eq }) => eq(r.id, room.id),
      with: {
        host: {
          columns: { id: true, name: true, nickname: true, houseId: true }
        },
        guest: {
          columns: { id: true, name: true, nickname: true, houseId: true }
        }
      }
    });

    return NextResponse.json({
      roomId: freshRoom?.id,
      roomCode: freshRoom?.roomCode,
      status: freshRoom?.status,
      gameState: freshRoom?.gameState,
      winnerId: freshRoom?.winnerId,
      finishReason: freshRoom?.finishReason,
      host: freshRoom?.host,
      guest: freshRoom?.guest,
    });

  } catch (error) {
    captureException(error, { route: "POST /api/battle/rooms/[code]/resign" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
