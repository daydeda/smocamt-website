import { BattleService } from "@/modules/battle/battle.service";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createInitialState } from "@/lib/games/ox";
import { getClientIp, AuditService } from "@/modules/audit/audit.service";
import { captureException } from "@/lib/util/logger";
import { z } from "zod";

const createRoomSchema = z.object({
  gameType: z.enum(["ox"]),
});

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

// POST /api/battle/rooms - Create a new room
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }


    const hostId = session.user.id;

    // Verify host user exists in database (handles stale session cookies after database resets)
    const hostExists = await BattleService.userExists(hostId);
    if (!hostExists) {
      return NextResponse.json({ error: "User not found in database. Please log out and sign in again." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = createRoomSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid room creation payload", details: parsed.error.format() }, { status: 400 });
    }

    const { gameType } = parsed.data;

    // Generate unique room code
    let roomCode = "";
    let attempts = 0;
    let unique = false;
    while (attempts < 10) {
      roomCode = generateRoomCode();
      const existing = await BattleService.isWaitingRoomCodeInUse(roomCode);
      if (!existing) {
        unique = true;
        break;
      }
      attempts++;
    }

    if (!unique) {
      return NextResponse.json({ error: "Failed to generate room code" }, { status: 500 });
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    const initialState = createInitialState();

    const newRoom = await BattleService.createRoom({
      roomCode,
      gameType,
      hostId,
      gameState: initialState,
      status: "waiting",
      currentTurn: 1, // Host is player 1
      expiresAt,
    });

    const ip = getClientIp(req);
    await AuditService.logAction({
      actorId: hostId,
      action: `Created P2P game room ${roomCode} (${gameType})`,
      ipAddress: ip,
    });

    return NextResponse.json({
      roomId: newRoom.id,
      roomCode: newRoom.roomCode,
      gameType: newRoom.gameType,
      expiresAt: newRoom.expiresAt,
      status: newRoom.status,
    });

  } catch (error) {
    captureException(error, { route: "POST /api/battle/rooms" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
