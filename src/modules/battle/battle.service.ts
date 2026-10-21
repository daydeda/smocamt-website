import { db } from "@/db";
import { gameRooms, gameStats, webrtcSignals } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { finalizeGameInDb } from "@/lib/games/stats-helper";

export type GameRoomRow = typeof gameRooms.$inferSelect;

export class BattleService {
  // ── Stats / leaderboard ────────────────────────────────────────────────

  /** Top OX players by wins, then win streak. */
  static async listLeaderboard(gameType: string) {
    return db.query.gameStats.findMany({
      where: (gs, { eq }) => eq(gs.gameType, gameType),
      orderBy: [desc(gameStats.wins), desc(gameStats.winStreak)],
      limit: 20,
      with: {
        user: {
          columns: { id: true, name: true, nickname: true, houseId: true, image: true }
        }
      }
    });
  }

  /** My OX stats — null/undefined when the user has never played. */
  static async getMyStats(userId: string) {
    // Fetch stats — null when the user has never played (US-FIX-20i AC-5);
    // the client renders a "no games yet" state instead of fabricated zeros.
    return db.query.gameStats.findFirst({
      where: (gs, { eq, and }) => and(eq(gs.userId, userId), eq(gs.gameType, "ox")),
    });
  }

  /** My last 10 finished games, with host + guest. */
  static async listMyMatchHistory(userId: string) {
    // Fetch match history (last 10 games)
    return db.query.gameRooms.findMany({
      where: (r, { eq, or, and }) => and(
        eq(r.status, "finished"),
        or(eq(r.hostId, userId), eq(r.guestId, userId))
      ),
      orderBy: desc(gameRooms.updatedAt),
      limit: 10,
      with: {
        host: {
          columns: { id: true, name: true, nickname: true, houseId: true }
        },
        guest: {
          columns: { id: true, name: true, nickname: true, houseId: true }
        }
      }
    });
  }

  // ── Room lookups ───────────────────────────────────────────────────────

  /** Does a users row exist for this id? (stale session cookies after database resets) */
  static async userExists(userId: string) {
    const row = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.id, userId),
      columns: { id: true }
    });
    return !!row;
  }

  /** Room by its 4-char code. */
  static async findRoomByCode(roomCode: string) {
    return db.query.gameRooms.findFirst({
      where: (r, { eq }) => eq(r.roomCode, roomCode),
    });
  }

  /** Room by code, with host + guest player info. */
  static async findRoomByCodeWithPlayers(roomCode: string) {
    return db.query.gameRooms.findFirst({
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
  }

  /** Room by id, with host + guest player info. */
  static async findRoomByIdWithPlayers(roomId: string) {
    return db.query.gameRooms.findFirst({
      where: (r, { eq }) => eq(r.id, roomId),
      with: {
        host: {
          columns: { id: true, name: true, nickname: true, houseId: true }
        },
        guest: {
          columns: { id: true, name: true, nickname: true, houseId: true }
        }
      }
    });
  }

  /** Room by id (fresh re-read after a finalize, to see the actual state). */
  static async findRoomById(roomId: string) {
    return db.query.gameRooms.findFirst({
      where: (r, { eq }) => eq(r.id, roomId),
    });
  }

  /** Current status + turn deadline of a room. */
  static async getRoomStatusAndDeadline(roomId: string) {
    return db.query.gameRooms.findFirst({
      where: (r, { eq }) => eq(r.id, roomId),
      columns: { status: true, turnDeadline: true },
    });
  }

  /** id/name/nickname/houseId of the given players. */
  static async listPlayers(playerIds: string[]) {
    return db.query.users.findMany({
      where: (u, { inArray }) => inArray(u.id, playerIds),
      columns: { id: true, name: true, nickname: true, houseId: true },
    });
  }

  // ── Room lifecycle ─────────────────────────────────────────────────────

  /** Is there an unexpired "waiting" room already using this code? */
  static async isWaitingRoomCodeInUse(roomCode: string) {
    const existing = await db.query.gameRooms.findFirst({
      where: (r, { eq, and, gt }) => and(
        eq(r.roomCode, roomCode),
        gt(r.expiresAt, new Date()),
        eq(r.status, "waiting")
      )
    });
    return !!existing;
  }

  /** Creates a new waiting room and returns it. */
  static async createRoom(values: typeof gameRooms.$inferInsert) {
    const [newRoom] = await db.insert(gameRooms).values(values).returning();
    return newRoom;
  }

  /** Lazy expiry of a waiting room. `updatedAt` is only stamped when given. */
  static async markRoomExpired(roomId: string, updatedAt?: Date) {
    await db.update(gameRooms)
      .set(updatedAt ? { status: "expired", updatedAt } : { status: "expired" })
      .where(eq(gameRooms.id, roomId));
  }

  /**
   * Guest claims a waiting room. Conditional on still being "waiting" so two
   * simultaneous joiners can't both win and overwrite each other's guestId.
   * Returns the claimed rows (empty if somebody else got there first).
   */
  static async claimWaitingRoom(roomId: string, guestId: string) {
    return db.update(gameRooms)
      .set({
        guestId,
        status: "connecting",
        updatedAt: new Date(),
      })
      .where(and(eq(gameRooms.id, roomId), eq(gameRooms.status, "waiting")))
      .returning({ id: gameRooms.id });
  }

  /**
   * Marks a "connecting" room active. Conditional so both peers reporting
   * "connected" can't reset the turn timer. Returns the activated rows.
   */
  static async activateConnectingRoom(roomId: string, turnDeadline: Date) {
    return db.update(gameRooms)
      .set({
        status: "active",
        turnDeadline,
        updatedAt: new Date(),
      })
      .where(and(eq(gameRooms.id, roomId), eq(gameRooms.status, "connecting")))
      .returning({ id: gameRooms.id });
  }

  /** Finalizes a game (resign / forfeit / win / draw) and updates stats in one transaction. */
  static async finalizeGame(
    room: { id: string; hostId: string; guestId: string | null },
    winnerId: string | null,
    reason: string,
  ) {
    await db.transaction(async (tx) => {
      await finalizeGameInDb(tx, room, winnerId, reason);
    });
  }

  // ── Moves ──────────────────────────────────────────────────────────────

  /**
   * Saves the final board conditionally (to prevent a race) and finalizes the
   * match + stats in one transaction. Returns false if the turn had already
   * changed or the game was no longer active.
   */
  static async applyFinalMove(
    room: GameRoomRow,
    nextState: GameRoomRow["gameState"],
    playerTurn: 1 | 2,
    winnerId: string | null,
    reason: string,
  ) {
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
    return updateSuccess;
  }

  /** Applies a non-final move: switches turn and renews the deadline, conditionally. Returns the updated rows. */
  static async applyOngoingMove(
    roomId: string,
    playerTurn: 1 | 2,
    nextState: GameRoomRow["gameState"],
    nextTurn: 1 | 2,
    turnDeadline: Date,
  ) {
    return db.update(gameRooms)
      .set({
        gameState: nextState,
        currentTurn: nextTurn,
        turnDeadline,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(gameRooms.id, roomId),
          eq(gameRooms.status, "active"),
          eq(gameRooms.currentTurn, playerTurn)
        )
      )
      .returning();
  }

  // ── WebRTC signalling ──────────────────────────────────────────────────

  /**
   * Appends one ICE candidate for (room, role). Browsers fire onicecandidate in
   * rapid bursts, so concurrent POSTs for the same (room, role) are the common
   * case, not the exception. A check-then-insert (SELECT existing, then INSERT if
   * missing) races: two concurrent requests can both see "no row" and both INSERT,
   * and the second violates the idx_webrtc_signals_room_role unique constraint.
   * Upsert via ON CONFLICT makes the read-modify-write atomic at the DB level
   * instead. Returns the written rows (empty once the 30-candidate cap is hit).
   */
  static async appendIceCandidate(roomId: string, role: "host" | "guest", iceCandidate: unknown) {
    return db.insert(webrtcSignals)
      .values({
        roomId,
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
  }

  /** Upserts the SDP offer/answer and/or a batch of ICE candidates for (room, role). */
  static async upsertSignals(
    roomId: string,
    role: "host" | "guest",
    signals: { sdpOffer?: string; sdpAnswer?: string; iceCandidates?: unknown[] },
  ) {
    const { sdpOffer, sdpAnswer, iceCandidates } = signals;
    await db.insert(webrtcSignals)
      .values({
        roomId,
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

  /** The opponent's stored signals for a room. */
  static async getOpponentSignal(roomId: string, opponentRole: "host" | "guest") {
    return db.query.webrtcSignals.findFirst({
      where: (s, { eq, and }) => and(eq(s.roomId, roomId), eq(s.role, opponentRole)),
    });
  }
}
