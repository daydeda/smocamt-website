import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import { updatePlayerStats, finalizeGameInDb, type GameDbClient } from "./stats-helper";
import { eq } from "drizzle-orm";

describe("OX Game Stats and Finalization", () => {
  let client: PGlite;
  let db: GameDbClient;

  beforeEach(async () => {
    client = new PGlite();
    
    // Create the minimal schema required for testing
    await client.exec(`
      CREATE TABLE users (
        id text PRIMARY KEY,
        prefix text,
        name text NOT NULL,
        email text NOT NULL UNIQUE,
        "emailVerified" timestamp with time zone,
        image text,
        role text DEFAULT 'student',
        roles jsonb DEFAULT '["student"]'::jsonb,
        house_id text,
        points integer DEFAULT 0 NOT NULL,
        no_show_count integer DEFAULT 0 NOT NULL,
        registration_blocked boolean DEFAULT false NOT NULL,
        qr_token text UNIQUE,
        student_id text UNIQUE,
        nickname text,
        faculty text,
        major text,
        position text,
        major_position text,
        smo_position text,
        anusmo_position text,
        image_transform jsonb,
        religion text,
        phone text UNIQUE,
        contact_channels text,
        chronic_diseases text,
        medical_history text,
        drug_allergies text,
        food_allergies text,
        dietary_restrictions text,
        fainting_history boolean,
        emergency_medication text,
        emergency_contacts jsonb,
        pdpa_consent boolean DEFAULT false,
        profile_completed boolean DEFAULT false,
        created_at timestamp with time zone DEFAULT now(),
        updated_at timestamp with time zone DEFAULT now()
      );

      CREATE TABLE game_rooms (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        room_code text NOT NULL,
        game_type text NOT NULL,
        host_id text NOT NULL REFERENCES users(id),
        guest_id text REFERENCES users(id),
        game_state jsonb NOT NULL,
        current_turn integer DEFAULT 1 NOT NULL,
        status text DEFAULT 'waiting' NOT NULL,
        winner_id text REFERENCES users(id),
        finish_reason text,
        turn_deadline timestamp with time zone,
        expires_at timestamp with time zone NOT NULL,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE webrtc_signals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id uuid NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
        role text NOT NULL,
        sdp_offer text,
        sdp_answer text,
        ice_candidates jsonb DEFAULT '[]'::jsonb,
        updated_at timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT idx_webrtc_signals_room_role UNIQUE (room_id, role)
      );

      CREATE TABLE game_stats (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_type text NOT NULL,
        wins integer DEFAULT 0 NOT NULL,
        losses integer DEFAULT 0 NOT NULL,
        draws integer DEFAULT 0 NOT NULL,
        win_streak integer DEFAULT 0 NOT NULL,
        best_streak integer DEFAULT 0 NOT NULL,
        total_games integer DEFAULT 0 NOT NULL,
        last_played_at timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT idx_game_stats_user_game UNIQUE (user_id, game_type)
      );
    `);

    // Structurally compatible pglite db standing in for the app's postgres-js db
    db = drizzlePglite(client, { schema }) as unknown as GameDbClient;

    // Seed test users
    await db.insert(schema.users).values([
      { id: "user1", name: "Host Player", email: "host@example.com" },
      { id: "user2", name: "Guest Player", email: "guest@example.com" },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  describe("updatePlayerStats", () => {
    it("should insert initial stats for a user", async () => {
      await updatePlayerStats(db, "user1", "win");

      const stats = await db.query.gameStats.findFirst({
        where: eq(schema.gameStats.userId, "user1"),
      });

      expect(stats).toBeDefined();
      expect(stats!.wins).toBe(1);
      expect(stats!.losses).toBe(0);
      expect(stats!.draws).toBe(0);
      expect(stats!.winStreak).toBe(1);
      expect(stats!.bestStreak).toBe(1);
      expect(stats!.totalGames).toBe(1);
    });

    it("should atomically increment wins and update win streak", async () => {
      // 1. Initial win
      await updatePlayerStats(db, "user1", "win");
      // 2. Second win
      await updatePlayerStats(db, "user1", "win");
      // 3. Loss (resets streak)
      await updatePlayerStats(db, "user1", "loss");

      const stats = await db.query.gameStats.findFirst({
        where: eq(schema.gameStats.userId, "user1"),
      });

      expect(stats!.wins).toBe(2);
      expect(stats!.losses).toBe(1);
      expect(stats!.winStreak).toBe(0);
      expect(stats!.bestStreak).toBe(2); // Best streak should remain 2
      expect(stats!.totalGames).toBe(3);
    });

    it("should handle draws and preserve win streak", async () => {
      await updatePlayerStats(db, "user1", "win");
      await updatePlayerStats(db, "user1", "draw");

      const stats = await db.query.gameStats.findFirst({
        where: eq(schema.gameStats.userId, "user1"),
      });

      expect(stats!.wins).toBe(1);
      expect(stats!.draws).toBe(1);
      expect(stats!.winStreak).toBe(1); // Streak preserved on draw
      expect(stats!.bestStreak).toBe(1);
      expect(stats!.totalGames).toBe(2);
    });
  });

  describe("finalizeGameInDb", () => {
    it("should finalize game and update stats", async () => {
      // Create a game room
      const roomId = "00000000-0000-0000-0000-000000000001";
      await db.insert(schema.gameRooms).values({
        id: roomId,
        roomCode: "TEST",
        gameType: "ox",
        hostId: "user1",
        guestId: "user2",
        gameState: { board: [0,0,0,0,0,0,0,0,0] },
        status: "active",
        expiresAt: new Date(Date.now() + 600000),
      });

      // Insert WebRTC signals to test cleanup
      await db.insert(schema.webrtcSignals).values({
        id: "00000000-0000-0000-0000-000000000002",
        roomId,
        role: "host",
        sdpOffer: "offer-data",
      });

      const room = { id: roomId, hostId: "user1", guestId: "user2" };
      await finalizeGameInDb(db, room, "user1", "win");

      // Verify room status changed to finished
      const updatedRoom = await db.query.gameRooms.findFirst({
        where: eq(schema.gameRooms.id, roomId),
      });
      expect(updatedRoom!.status).toBe("finished");
      expect(updatedRoom!.winnerId).toBe("user1");
      expect(updatedRoom!.finishReason).toBe("win");

      // Verify stats updated
      const hostStats = await db.query.gameStats.findFirst({
        where: eq(schema.gameStats.userId, "user1"),
      });
      const guestStats = await db.query.gameStats.findFirst({
        where: eq(schema.gameStats.userId, "user2"),
      });
      expect(hostStats!.wins).toBe(1);
      expect(guestStats!.losses).toBe(1);

      // Verify signals deleted
      const signals = await db.query.webrtcSignals.findMany({
        where: eq(schema.webrtcSignals.roomId, roomId),
      });
      expect(signals.length).toBe(0);
    });

    it("should be idempotent and not update stats twice on double finalization", async () => {
      // Create a game room
      const roomId = "00000000-0000-0000-0000-000000000001";
      await db.insert(schema.gameRooms).values({
        id: roomId,
        roomCode: "TEST",
        gameType: "ox",
        hostId: "user1",
        guestId: "user2",
        gameState: { board: [0,0,0,0,0,0,0,0,0] },
        status: "active",
        expiresAt: new Date(Date.now() + 600000),
      });

      const room = { id: roomId, hostId: "user1", guestId: "user2" };

      // Finalize twice
      await finalizeGameInDb(db, room, "user1", "win");
      await finalizeGameInDb(db, room, "user1", "win");

      // Verify stats are only updated once
      const hostStats = await db.query.gameStats.findFirst({
        where: eq(schema.gameStats.userId, "user1"),
      });
      expect(hostStats!.wins).toBe(1); // Should still be 1, not 2
    });
  });
});
