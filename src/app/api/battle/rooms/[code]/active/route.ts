import { db } from "@/db";
import { gameRooms } from "@/db/schema";
import { and, eq } from "drizzle-orm";
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

    const room = await db.query.gameRooms.findFirst({
      where: (r, { eq }) => eq(r.roomCode, roomCode),
    });

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
      const activated = await db.update(gameRooms)
        .set({
          status: "active",
          turnDeadline,
          updatedAt: new Date(),
        })
        .where(and(eq(gameRooms.id, room.id), eq(gameRooms.status, "connecting")))
        .returning({ id: gameRooms.id });

      if (activated.length > 0) {
        return NextResponse.json({ success: true, status: "active", turnDeadline });
      }

      const current = await db.query.gameRooms.findFirst({
        where: (r, { eq }) => eq(r.id, room.id),
        columns: { status: true, turnDeadline: true },
      });
      return NextResponse.json({ success: true, status: current?.status ?? room.status, turnDeadline: current?.turnDeadline ?? null });
    }

    return NextResponse.json({ success: true, status: room.status });

  } catch (error) {
    captureException(error, { route: "POST /api/battle/rooms/[code]/active" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
