import { db } from "@/db";
import { webrtcSignals } from "@/db/schema";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { captureException } from "@/lib/logger";
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

    const room = await db.query.gameRooms.findFirst({
      where: (r, { eq }) => eq(r.roomCode, roomCode),
    });

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

    // Browsers fire onicecandidate in rapid bursts, so concurrent POSTs for the
    // same (room, role) are the common case, not the exception. A check-then-insert
    // (SELECT existing, then INSERT if missing) races: two concurrent requests can
    // both see "no row" and both INSERT, and the second violates the
    // idx_webrtc_signals_room_role unique constraint. Upsert via ON CONFLICT makes
    // the read-modify-write atomic at the DB level instead.
    if (iceCandidate !== undefined) {
      const result = await db.insert(webrtcSignals)
        .values({
          roomId: room.id,
          role,
          iceCandidates: [iceCandidate],
        })
        .onConflictDoUpdate({
          target: [webrtcSignals.roomId, webrtcSignals.role],
          set: {
            // Table-qualified: "excluded" (the proposed insert row) also has an
            // ice_candidates column, so the bare name is ambiguous inside
            // ON CONFLICT DO UPDATE and Postgres rejects the whole query.
            iceCandidates: sql`webrtc_signals.ice_candidates || ${JSON.stringify(iceCandidate)}::jsonb`,
            updatedAt: new Date(),
          },
          setWhere: sql`jsonb_typeof(webrtc_signals.ice_candidates) = 'array' AND jsonb_array_length(webrtc_signals.ice_candidates) < 30`,
        })
        .returning();

      if (result.length === 0) {
        return NextResponse.json({ error: "ICE candidates limit (30) reached" }, { status: 400 });
      }
    } else {
      if (iceCandidates !== undefined && iceCandidates.length > 30) {
        return NextResponse.json({ error: "ICE candidates limit (30) exceeded" }, { status: 400 });
      }

      await db.insert(webrtcSignals)
        .values({
          roomId: room.id,
          role,
          sdpOffer: sdpOffer || null,
          sdpAnswer: sdpAnswer || null,
          iceCandidates: iceCandidates || [],
        })
        .onConflictDoUpdate({
          target: [webrtcSignals.roomId, webrtcSignals.role],
          set: {
            ...(sdpOffer !== undefined ? { sdpOffer } : {}),
            ...(sdpAnswer !== undefined ? { sdpAnswer } : {}),
            ...(iceCandidates !== undefined ? { iceCandidates } : {}),
            updatedAt: new Date(),
          },
        });
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

    const room = await db.query.gameRooms.findFirst({
      where: (r, { eq }) => eq(r.roomCode, roomCode),
    });

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    if (room.hostId !== userId && room.guestId !== userId) {
      return NextResponse.json({ error: "Unauthorized to access this room" }, { status: 403 });
    }

    const myRole = room.hostId === userId ? "host" : "guest";
    const opponentRole = myRole === "host" ? "guest" : "host";

    const opponentSignal = await db.query.webrtcSignals.findFirst({
      where: (s, { eq, and }) => and(eq(s.roomId, room.id), eq(s.role, opponentRole)),
    });

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
