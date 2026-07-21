import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

// Retrieve the active PGlite instance created by @/db
const testClient = (globalThis as any).pglite;

// Mock auth() dynamically based on our test variables
let currentUserId = "user-host";
// Battle is staged behind BATTLE_ALLOWED_ROLES (smo/anusmo/admin) for prod
// testing; the session role must clear that gate for the end-to-end flow to
// reach the room-creation/join/move handlers. Defaults to an allowed role;
// the access-control test below flips it to an unprivileged role.
let currentUserRole = "smo";
vi.mock("@/auth", () => {
  return {
    auth: vi.fn(async () => {
      return {
        user: {
          id: currentUserId,
          name: currentUserId === "user-host" ? "Host Player" : currentUserId === "user-guest" ? "Guest Player" : "Student Player",
          email: currentUserId === "user-host" ? "host@example.com" : currentUserId === "user-guest" ? "guest@example.com" : "student@example.com",
          role: currentUserRole,
          roles: [currentUserRole],
        },
      };
    }),
  };
});

// Import route handlers
import { POST as createRoom } from "@/app/api/battle/rooms/route";
import { POST as joinRoom } from "@/app/api/battle/rooms/[code]/join/route";
import { GET as getRoomState } from "@/app/api/battle/rooms/[code]/state/route";
import { POST as makeMove } from "@/app/api/battle/rooms/[code]/move/route";
import { GET as getSignal, POST as postSignal } from "@/app/api/battle/rooms/[code]/signal/route";
import { POST as activateRoom } from "@/app/api/battle/rooms/[code]/active/route";

describe("OX Battle System End-to-End API Flow and Performance Verification", () => {
  beforeAll(async () => {
    // Create the schema tables required for the battle APIs (without foreign key constraints for simplicity in tests)
    await testClient.exec(`
      CREATE TABLE IF NOT EXISTS houses (
        id text PRIMARY KEY,
        name text NOT NULL,
        color text DEFAULT '#6366f1',
        points integer DEFAULT 0 NOT NULL,
        faculty text DEFAULT 'CAMT' NOT NULL,
        color_group text DEFAULT 'red' NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
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

      CREATE TABLE IF NOT EXISTS game_rooms (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        room_code text NOT NULL,
        game_type text NOT NULL,
        host_id text NOT NULL,
        guest_id text,
        game_state jsonb NOT NULL,
        current_turn integer DEFAULT 1 NOT NULL,
        status text DEFAULT 'waiting' NOT NULL,
        winner_id text,
        finish_reason text,
        turn_deadline timestamp with time zone,
        expires_at timestamp with time zone NOT NULL,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webrtc_signals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id uuid NOT NULL,
        role text NOT NULL,
        sdp_offer text,
        sdp_answer text,
        ice_candidates jsonb DEFAULT '[]'::jsonb,
        updated_at timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT idx_webrtc_signals_room_role UNIQUE (room_id, role)
      );

      CREATE TABLE IF NOT EXISTS game_stats (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id text NOT NULL,
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

      CREATE TABLE IF NOT EXISTS audit_logs (
        id uuid PRIMARY KEY,
        seq bigserial NOT NULL,
        timestamp timestamp with time zone DEFAULT now(),
        actor_id text,
        target_id text,
        action text NOT NULL,
        ip_address text,
        prev_hash text NOT NULL DEFAULT '',
        row_hash text NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS rate_limit (
        key text PRIMARY KEY,
        count integer DEFAULT 0 NOT NULL,
        expires_at timestamp with time zone NOT NULL
      );
    `);

    // Seed mock houses and users with all default/non-null values explicitly set
    // to prevent Drizzle/PGlite from generating default/multi-row aborts.
    await db.insert(schema.houses).values([
      { id: "red", name: "Mom", color: "#ef4444", points: 0 },
      { id: "blue", name: "Luang", color: "#3b82f6", points: 0 },
    ]);

    await db.insert(schema.users).values([
      {
        id: "user-host",
        name: "Host Player",
        email: "host@example.com",
        houseId: "red",
        points: 0,
        role: "student",
        roles: ["student"],
        pdpaConsent: false,
        profileCompleted: false
      },
      {
        id: "user-guest",
        name: "Guest Player",
        email: "guest@example.com",
        houseId: "blue",
        points: 0,
        role: "student",
        roles: ["student"],
        pdpaConsent: false,
        profileCompleted: false
      },
    ]);
  });

  afterAll(async () => {
    // Clean up our tables to leave the shared database instance pristine
    await testClient.exec(`
      DROP TABLE IF EXISTS rate_limit;
      DROP TABLE IF EXISTS audit_logs;
      DROP TABLE IF EXISTS game_stats;
      DROP TABLE IF EXISTS webrtc_signals;
      DROP TABLE IF EXISTS game_rooms;
      DROP TABLE IF EXISTS users;
      DROP TABLE IF EXISTS houses;
    `);
  });

  it("should complete the full battle flow with status changes, performance optimizations, and correct stats", async () => {
    // ----------------------------------------------------
    // 1. Create Room (Host creates room)
    // ----------------------------------------------------
    currentUserId = "user-host";
    const createReq = new Request("http://localhost/api/battle/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameType: "ox" }),
    });
    
    const createRes = await createRoom(createReq);
    expect(createRes.status).toBe(200);
    
    const roomInfo = await createRes.json();
    expect(roomInfo.roomId).toBeDefined();
    expect(roomInfo.roomCode).toHaveLength(4);
    expect(roomInfo.status).toBe("waiting");

    const roomCode = roomInfo.roomCode;
    const paramsPromise = Promise.resolve({ code: roomCode });

    // ----------------------------------------------------
    // 2. Initial signal poll checking roomStatus piggyback (US-PERF-21b)
    // ----------------------------------------------------
    const preJoinSignalReq = new Request(`http://localhost/api/battle/rooms/${roomCode}/signal`);
    const preJoinSignalRes = await getSignal(preJoinSignalReq, { params: paramsPromise });
    expect(preJoinSignalRes.status).toBe(200);
    const preJoinSignalData = await preJoinSignalRes.json();
    expect(preJoinSignalData.roomStatus).toBe("waiting");

    // ----------------------------------------------------
    // 3. Guest Joins Room
    // ----------------------------------------------------
    currentUserId = "user-guest";
    const joinReq = new Request(`http://localhost/api/battle/rooms/${roomCode}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    
    const joinRes = await joinRoom(joinReq, { params: paramsPromise });
    expect(joinRes.status).toBe(200);
    const joinData = await joinRes.json();
    expect(joinData.status).toBe("connecting");
    expect(joinData.guestId).toBe("user-guest");

    // ----------------------------------------------------
    // 4. GET /state Performance Optimizations (US-PERF-21e)
    // ----------------------------------------------------
    // Querying with players=1 should include user profile objects
    currentUserId = "user-host";
    const stateWithPlayersReq = new Request(`http://localhost/api/battle/rooms/${roomCode}/state?players=1`);
    const stateWithPlayersRes = await getRoomState(stateWithPlayersReq, { params: paramsPromise });
    expect(stateWithPlayersRes.status).toBe(200);
    const stateWithPlayersData = await stateWithPlayersRes.json();
    expect(stateWithPlayersData.host).toBeDefined();
    expect(stateWithPlayersData.guest).toBeDefined();
    expect(stateWithPlayersData.host.id).toBe("user-host");
    expect(stateWithPlayersData.guest.id).toBe("user-guest");

    // Subsequent query without players parameter should NOT include host/guest profiles (reduces DB queries)
    const stateNoPlayersReq = new Request(`http://localhost/api/battle/rooms/${roomCode}/state`);
    const stateNoPlayersRes = await getRoomState(stateNoPlayersReq, { params: paramsPromise });
    expect(stateNoPlayersRes.status).toBe(200);
    const stateNoPlayersData = await stateNoPlayersRes.json();
    expect(stateNoPlayersData.host).toBeUndefined();
    expect(stateNoPlayersData.guest).toBeUndefined();
    expect(stateNoPlayersData.status).toBe("connecting");

    // ----------------------------------------------------
    // 5. WebRTC Signaling Exchange (US-PERF-21c)
    // ----------------------------------------------------
    // Host posts SDP offer
    currentUserId = "user-host";
    const postOfferReq = new Request(`http://localhost/api/battle/rooms/${roomCode}/signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "host", sdpOffer: "host-sdp-offer" }),
    });
    const postOfferRes = await postSignal(postOfferReq, { params: paramsPromise });
    expect(postOfferRes.status).toBe(200);

    // Guest gets SDP offer and verifies roomStatus is "connecting" (piggyback check — US-PERF-21b)
    currentUserId = "user-guest";
    const getOfferReq = new Request(`http://localhost/api/battle/rooms/${roomCode}/signal`);
    const getOfferRes = await getSignal(getOfferReq, { params: paramsPromise });
    expect(getOfferRes.status).toBe(200);
    const offerData = await getOfferRes.json();
    expect(offerData.sdpOffer).toBe("host-sdp-offer");
    expect(offerData.roomStatus).toBe("connecting");

    // Guest posts SDP answer
    const postAnswerReq = new Request(`http://localhost/api/battle/rooms/${roomCode}/signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "guest", sdpAnswer: "guest-sdp-answer" }),
    });
    const postAnswerRes = await postSignal(postAnswerReq, { params: paramsPromise });
    expect(postAnswerRes.status).toBe(200);

    // Host gets SDP answer
    currentUserId = "user-host";
    const getAnswerReq = new Request(`http://localhost/api/battle/rooms/${roomCode}/signal`);
    const getAnswerRes = await getSignal(getAnswerReq, { params: paramsPromise });
    expect(getAnswerRes.status).toBe(200);
    const answerData = await getAnswerRes.json();
    expect(answerData.sdpAnswer).toBe("guest-sdp-answer");

    // ----------------------------------------------------
    // 6. Active Room Transition
    // ----------------------------------------------------
    const activeReq = new Request(`http://localhost/api/battle/rooms/${roomCode}/active`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const activeRes = await activateRoom(activeReq, { params: paramsPromise });
    expect(activeRes.status).toBe(200);
    const activeData = await activeRes.json();
    expect(activeData.status).toBe("active");

    // ----------------------------------------------------
    // 7. OX Game Play and POST /move Optimization (US-PERF-21e)
    // ----------------------------------------------------
    // Let's verify who is current turn (should be Host: turn = 1)
    const activeStateRes = await getRoomState(stateNoPlayersReq, { params: paramsPromise });
    const activeState = await activeStateRes.json();
    expect(activeState.currentTurn).toBe(1);
    expect(activeState.status).toBe("active");

    // Move 1: Host places mark at cell 1
    currentUserId = "user-host";
    const move1Req = new Request(`http://localhost/api/battle/rooms/${roomCode}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cell: 1 }),
    });
    const move1Res = await makeMove(move1Req, { params: paramsPromise });
    expect(move1Res.status).toBe(200);
    const move1Data = await move1Res.json();
    expect(move1Data.gameState.board[0]).toBe(1); // cell 1 marked by Host (1)
    expect(move1Data.currentTurn).toBe(2); // Next is Guest
    // Verify that the response does NOT include host or guest objects (no extra joins/queries)
    expect(move1Data.host).toBeUndefined();
    expect(move1Data.guest).toBeUndefined();

    // Move 2: Guest places mark at cell 4
    currentUserId = "user-guest";
    const move2Req = new Request(`http://localhost/api/battle/rooms/${roomCode}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cell: 4 }),
    });
    const move2Res = await makeMove(move2Req, { params: paramsPromise });
    expect(move2Res.status).toBe(200);
    const move2Data = await move2Res.json();
    expect(move2Data.gameState.board[3]).toBe(2); // cell 4 marked by Guest (2)
    expect(move2Data.currentTurn).toBe(1);

    // Move 3: Host places mark at cell 2
    currentUserId = "user-host";
    const move3Req = new Request(`http://localhost/api/battle/rooms/${roomCode}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cell: 2 }),
    });
    await makeMove(move3Req, { params: paramsPromise });

    // Move 4: Guest places mark at cell 5
    currentUserId = "user-guest";
    const move4Req = new Request(`http://localhost/api/battle/rooms/${roomCode}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cell: 5 }),
    });
    await makeMove(move4Req, { params: paramsPromise });

    // Move 5: Host places mark at cell 3 (winning move: cells 1, 2, 3)
    currentUserId = "user-host";
    const move5Req = new Request(`http://localhost/api/battle/rooms/${roomCode}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cell: 3 }),
    });
    const move5Res = await makeMove(move5Req, { params: paramsPromise });
    expect(move5Res.status).toBe(200);
    const move5Data = await move5Res.json();
    
    // Verify game finished and host won
    expect(move5Data.status).toBe("finished");
    expect(move5Data.winnerId).toBe("user-host");
    expect(move5Data.finishReason).toBe("win");

    // ----------------------------------------------------
    // 8. Statistics Verification
    // ----------------------------------------------------
    const hostStats = await db.query.gameStats.findFirst({
      where: eq(schema.gameStats.userId, "user-host"),
    });
    expect(hostStats).toBeDefined();
    expect(hostStats!.wins).toBe(1);
    expect(hostStats!.losses).toBe(0);
    expect(hostStats!.totalGames).toBe(1);
    expect(hostStats!.winStreak).toBe(1);

    const guestStats = await db.query.gameStats.findFirst({
      where: eq(schema.gameStats.userId, "user-guest"),
    });
    expect(guestStats).toBeDefined();
    expect(guestStats!.wins).toBe(0);
    expect(guestStats!.losses).toBe(1);
    expect(guestStats!.totalGames).toBe(1);
    expect(guestStats!.winStreak).toBe(0);
  });

  it("should reject room creation from a role outside BATTLE_ALLOWED_ROLES (403)", async () => {
    currentUserId = "user-student";
    currentUserRole = "student";
    try {
      const createReq = new Request("http://localhost/api/battle/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameType: "ox" }),
      });
      const createRes = await createRoom(createReq);
      expect(createRes.status).toBe(403);
    } finally {
      currentUserId = "user-host";
      currentUserRole = "smo";
    }
  });
});
