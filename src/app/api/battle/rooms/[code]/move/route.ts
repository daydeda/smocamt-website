import { db } from "@/db";
import { gameRooms } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { validateMove, applyMove, checkResult, OXState } from "@/lib/games/ox";
import { finalizeGameInDb } from "@/lib/games/stats-helper";
import { getClientIp, AuditService } from "@/modules/audit/audit.service";
import { captureException } from "@/lib/util/logger";
import { z } from "zod";

const moveSchema = z.object({
  cell: z.number().int().min(1).max(9),
});

// POST /api/battle/rooms/[code]/move - Submit a move
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

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = moveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid move payload (cell must be integer 1-9)", details: parsed.error.format() }, { status: 400 });
    }

    const { cell } = parsed.data;

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

    // 1. Lazy evaluation of turn timeout forfeit
    if (room.status === "active" && room.turnDeadline && room.turnDeadline < now) {
      const winnerId = room.currentTurn === 1 ? (room.guestId || null) : room.hostId;
      if (winnerId) {
        await db.transaction(async (tx) => {
          await finalizeGameInDb(tx, room, winnerId, "forfeit");
        });
      }
      return NextResponse.json({ error: "Turn timed out, game finished" }, { status: 400 });
    }

    if (room.status !== "active") {
      return NextResponse.json({ error: "Game is not active" }, { status: 400 });
    }

    // 2. Validate current turn
    const expectedUser = room.currentTurn === 1 ? room.hostId : room.guestId;
    if (expectedUser !== userId) {
      return NextResponse.json({ error: "Not your turn" }, { status: 400 });
    }

    const state = room.gameState as OXState;
    const playerTurn = room.currentTurn as 1 | 2;

    // 3. Validate move legality
    if (!validateMove(state, { cell: cell as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 })) {
      return NextResponse.json({ error: "Illegal move" }, { status: 400 });
    }

    // 4. Apply move
    const nextState = applyMove(state, { cell: cell as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }, playerTurn);
    const gameCheck = checkResult(nextState);

    if (gameCheck.status === "win" || gameCheck.status === "draw") {
      const winnerId = gameCheck.status === "win" 
        ? (gameCheck.winner === 1 ? room.hostId : room.guestId) 
        : null;
      
      const reason = gameCheck.status === "win" ? "win" : "draw";

      let updateSuccess = false;
      await db.transaction(async (tx) => {
        // Save final state of board conditionally to prevent race condition
        const updated = await tx.update(gameRooms)
          .set({ gameState: nextState })
          .where(
            and(
              eq(gameRooms.id, room.id),
              eq(gameRooms.status, "active"),
              eq(gameRooms.currentTurn, playerTurn)
            )
          )
          .returning();

        if (updated.length > 0) {
          updateSuccess = true;
          // Finalize match and update stats
          await finalizeGameInDb(tx, room, winnerId, reason);
        }
      });

      if (!updateSuccess) {
        return NextResponse.json({ error: "Conflict: turn has already changed or game is not active" }, { status: 409 });
      }

      const ip = getClientIp(req);
      await AuditService.logAction({
        actorId: userId,
        action: `Finished OX game room ${roomCode} with status ${gameCheck.status}`,
        ipAddress: ip,
      });

      // Compose from values already in scope — no re-query (US-PERF-21e).
      // The client only consumes game fields here, not player info.
      return NextResponse.json({
        roomId: room.id,
        roomCode: room.roomCode,
        status: "finished",
        gameState: nextState,
        currentTurn: playerTurn,
        winnerId,
        finishReason: reason,
        turnDeadline: null,
      });

    } else {
      // Ongoing: switch turn, renew deadline
      const nextTurn = room.currentTurn === 1 ? 2 : 1;
      const turnDeadline = new Date(Date.now() + 60 * 1000); // 60s

      const updated = await db.update(gameRooms)
        .set({
          gameState: nextState,
          currentTurn: nextTurn,
          turnDeadline,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(gameRooms.id, room.id),
            eq(gameRooms.status, "active"),
            eq(gameRooms.currentTurn, playerTurn)
          )
        )
        .returning();

      if (updated.length === 0) {
        return NextResponse.json({ error: "Conflict: turn has already changed or game is not active" }, { status: 409 });
      }

      // The conditional UPDATE's .returning() row is the fresh state — no re-query (US-PERF-21e)
      const fresh = updated[0];
      return NextResponse.json({
        roomId: fresh.id,
        roomCode: fresh.roomCode,
        status: fresh.status,
        gameState: fresh.gameState,
        currentTurn: fresh.currentTurn,
        winnerId: fresh.winnerId,
        finishReason: fresh.finishReason,
        turnDeadline: fresh.turnDeadline,
      });
    }

  } catch (error) {
    captureException(error, { route: "POST /api/battle/rooms/[code]/move" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
