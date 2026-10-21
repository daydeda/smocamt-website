import { BattleService } from "@/modules/battle/battle.service";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { captureException } from "@/lib/util/logger";

// POST /api/battle/rooms/[code]/active - Mark room as active (WebRTC connected)
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

    const room = await BattleService.findRoomByCode(roomCode);

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    if (room.hostId !== userId && room.guestId !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // A room can only go active once a guest has joined ("connecting"); a
    // "waiting" room has no opponent, so activating it would start a game
    // nobody can finish.
    if (room.status === "waiting") {
      return NextResponse.json({ error: "Waiting for an opponent to join" }, { status: 400 });
    }

    if (room.status === "connecting") {
      const turnDeadline = new Date(Date.now() + 60 * 1000); // 60s

      // Conditional so both peers reporting "connected" can't reset the turn timer
      const activated = await BattleService.activateConnectingRoom(room.id, turnDeadline);

      if (activated.length > 0) {
        return NextResponse.json({ success: true, status: "active", turnDeadline });
      }

      const current = await BattleService.getRoomStatusAndDeadline(room.id);
      return NextResponse.json({ success: true, status: current?.status ?? room.status, turnDeadline: current?.turnDeadline ?? null });
    }

    return NextResponse.json({ success: true, status: room.status });

  } catch (error) {
    captureException(error, { route: "POST /api/battle/rooms/[code]/active" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
