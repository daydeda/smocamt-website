import { BattleService } from "@/modules/battle/battle.service";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { captureException } from "@/lib/util/logger";
import { z } from "zod";

const iceCandidateSchema = z.object({
  candidate: z.string(),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().nullable().optional(),
  usernameFragment: z.string().nullable().optional(),
});

const signalSchema = z.object({
  role: z.enum(["host", "guest"]),
  sdpOffer: z.string().max(20000).optional(),
  sdpAnswer: z.string().max(20000).optional(),
  iceCandidate: iceCandidateSchema.optional(),
  iceCandidates: z.array(iceCandidateSchema).optional(),
});

// POST /api/battle/rooms/[code]/signal - Upload my WebRTC signals (SDP/ICE)
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
      return NextResponse.json({ error: "Unauthorized to access this room" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = signalSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid signal payload", details: parsed.error.format() }, { status: 400 });
    }

    const { role, sdpOffer, sdpAnswer, iceCandidate, iceCandidates } = parsed.data;

    if ((role === "host" && room.hostId !== userId) || (role === "guest" && room.guestId !== userId)) {
      return NextResponse.json({ error: "Invalid role for this user" }, { status: 400 });
    }

    if (iceCandidate !== undefined) {
      const result = await BattleService.appendIceCandidate(room.id, role, iceCandidate);

      if (result.length === 0) {
        return NextResponse.json({ error: "ICE candidates limit (30) reached" }, { status: 400 });
      }
    } else {
      if (iceCandidates !== undefined && iceCandidates.length > 30) {
        return NextResponse.json({ error: "ICE candidates limit (30) exceeded" }, { status: 400 });
      }

      await BattleService.upsertSignals(room.id, role, { sdpOffer, sdpAnswer, iceCandidates });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    captureException(error, { route: "POST /api/battle/rooms/[code]/signal" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// GET /api/battle/rooms/[code]/signal - Retrieve opponent's WebRTC signals (SDP/ICE)
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

    const room = await BattleService.findRoomByCode(roomCode);

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    if (room.hostId !== userId && room.guestId !== userId) {
      return NextResponse.json({ error: "Unauthorized to access this room" }, { status: 403 });
    }

    const myRole = room.hostId === userId ? "host" : "guest";
    const opponentRole = myRole === "host" ? "guest" : "host";

    const opponentSignal = await BattleService.getOpponentSignal(room.id, opponentRole);

    return NextResponse.json({
      role: opponentRole,
      // Piggybacked room status (US-PERF-21b): this endpoint is polled at 1s during
      // the handshake and already fetched the room row — lets clients react to
      // "active" without waiting for the slower state poll. No extra query.
      roomStatus: room.status,
      sdpOffer: opponentSignal?.sdpOffer || null,
      sdpAnswer: opponentSignal?.sdpAnswer || null,
      iceCandidates: opponentSignal?.iceCandidates || [],
      updatedAt: opponentSignal?.updatedAt || null,
    });

  } catch (error) {
    captureException(error, { route: "GET /api/battle/rooms/[code]/signal" });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
