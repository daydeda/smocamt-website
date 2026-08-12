"use client";

import { StudentNav } from "@/components/layout/StudentNav";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Swords, Trophy, AlertTriangle, ArrowLeft, Loader2, Zap, Hourglass, LogOut, Award, RefreshCcw, RotateCcw, Info, PartyPopper, Frown, Handshake } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/lib/LanguageContext";
import dynamic from "next/dynamic";

// Canvas, not SVG: Android/Chrome "force dark" auto-inverts inline <svg> DOM
// content, but leaves <canvas> alone like a raster image, so the join QR
// stays scannable on phones with dark mode forced on.
const QRCodeCanvas = dynamic(() => import("qrcode.react").then((mod) => mod.QRCodeCanvas), {
  ssr: false,
});

interface RoomClientProps {
  initialSession: { user: { id: string; name?: string | null } } | null;
  roomCode: string;
}

interface Player {
  id: string;
  name: string;
  nickname: string | null;
  houseId: string | null;
}

interface OXState {
  board: number[]; // 0 = empty, 1 = X (Host), 2 = O (Guest)
}

export function RoomClient({ initialSession, roomCode }: RoomClientProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const user = initialSession?.user;
  const roomCodeUpper = roomCode.toUpperCase();

  // State
  const [roomId, setRoomId] = useState<string>("");
  const [status, setStatus] = useState<string>("waiting");
  const [host, setHost] = useState<Player | null>(null);
  const [guest, setGuest] = useState<Player | null>(null);
  const [gameState, setGameState] = useState<OXState>({ board: [0,0,0, 0,0,0, 0,0,0] });
  const [currentTurn, setCurrentTurn] = useState<number>(1);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [finishReason, setFinishReason] = useState<string | null>(null);
  const [turnDeadline, setTurnDeadline] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(60);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  
  // Connection State
  const [connType, setConnType] = useState<"webrtc" | "polling">("polling");
  const [webrtcState, setWebrtcState] = useState<string>("disconnected");
  const [isTabVisible, setIsTabVisible] = useState<boolean>(true);

  // Tab Visibility handler to pause polling when page is in background
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibility = () => {
      setIsTabVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // WebRTC Refs
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const iceCandidatesQueue = useRef<RTCIceCandidateInit[]>([]);
  const isInitiator = useRef<boolean>(false);
  const webrtcActive = useRef<boolean>(false);

  // Polling intervals refs
  const statePollInterval = useRef<NodeJS.Timeout | null>(null);
  const signalPollInterval = useRef<NodeJS.Timeout | null>(null);
  // WebRTC fallback watchdog (US-PERF-21a): the connecting screen promises a 10s cutover
  const webrtcTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Prevents overlapping signaling polls (interval tick + immediate kicks — US-PERF-21c)
  const signalPollBusy = useRef<boolean>(false);
  // Once both players are known, state polls stop asking for the (joined) player info (US-PERF-21e)
  const playersKnownRef = useRef<boolean>(false);

  const getMyPlayerNumber = () => {
    if (!user) return 0;
    if (host && user.id === host.id) return 1; // Host/X
    if (guest && user.id === guest.id) return 2; // Guest/O
    return 0;
  };

  const myNumber = getMyPlayerNumber();
  const myTurn = status === "active" && currentTurn === myNumber;
  // Turn-awareness only matters for the in-game fallback poll (US-PERF-21d);
  // pinning it to false otherwise keeps the poll effect from restarting per turn on WebRTC games.
  const turnAwareMyTurn = status === "active" && connType === "polling" ? myTurn : false;

  useEffect(() => {
    playersKnownRef.current = Boolean(host && guest);
  }, [host, guest]);

  // Initialize and check room
  useEffect(() => {
    async function checkRoom() {
      try {
        const res = await fetch(`/api/battle/rooms/${roomCodeUpper}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || t.battleErrorRoomNotFound);
        }
        const data = await res.json();
        setRoomId(data.roomId);
        setStatus(data.status);
        setHost(data.host);
        setGuest(data.guest);

        // If guest has already joined or I am the guest, we will be in connecting
        isInitiator.current = user?.id === data.host.id;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : t.battleErrorFetchRoom);
      }
    }
    checkRoom();
  }, [roomCodeUpper, user?.id, t]);

  // Main game state polling (dynamic interval, pauses on hidden tabs)
  useEffect(() => {
    if (!roomId || status === "finished" || status === "expired" || !isTabVisible) {
      if (statePollInterval.current) {
        clearInterval(statePollInterval.current);
        statePollInterval.current = null;
      }
      return;
    }

    const poll = async () => {
      try {
        // Ask for player info only until both players are known (US-PERF-21e)
        const playersParam = playersKnownRef.current ? "" : "?players=1";
        const res = await fetch(`/api/battle/rooms/${roomCodeUpper}/state${playersParam}`);
        if (!res.ok) return;
        const data = await res.json();

        // Sync basic room info (players guarded: absent when not requested, and
        // identity-preserved so unchanged data doesn't churn state/effects)
        setStatus(data.status);
        if (data.host) setHost(prev => (prev && prev.id === data.host.id ? prev : data.host));
        if (data.guest) setGuest(prev => (prev && prev.id === data.guest.id ? prev : data.guest));
        setGameState(data.gameState);
        setCurrentTurn(data.currentTurn);
        setWinnerId(data.winnerId);
        setFinishReason(data.finishReason);
        setTurnDeadline(data.turnDeadline);
      } catch (err) {
        console.error("State polling error:", err);
      }
    };

    // Phase-aware interval (US-PERF-21b/21d): pre-game phases are short-lived so they
    // poll fast; in-game fallback polls fast only while waiting for the opponent;
    // a healthy WebRTC session needs only slow reconciliation.
    const intervalMs =
      status === "waiting" || status === "connecting" ? 2000
      : connType === "webrtc" ? 30000
      : turnAwareMyTurn ? 10000
      : 2500;

    poll(); // Run instantly on hook setup/change
    statePollInterval.current = setInterval(poll, intervalMs);

    return () => {
      if (statePollInterval.current) {
        clearInterval(statePollInterval.current);
        statePollInterval.current = null;
      }
    };
  }, [roomId, status, connType, isTabVisible, roomCodeUpper, turnAwareMyTurn]);

  // Turn timer countdown
  useEffect(() => {
    if (!turnDeadline || status !== "active") return;

    const updateTimer = () => {
      const diff = new Date(turnDeadline).getTime() - Date.now();
      const seconds = Math.max(0, Math.ceil(diff / 1000));
      setTimeLeft(seconds);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [turnDeadline, status]);

  // WebRTC Setup Logic
  const setupWebRTC = async () => {
    try {
      setWebrtcState("initializing");
      
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });
      pcRef.current = pc;

      // Fallback watchdog (US-PERF-21a): browsers can sit in "checking" for 15-40s
      // before declaring failure — cut over to HTTP polling after 10s as the UI promises,
      // and mark the room active so the game actually starts.
      webrtcTimeoutRef.current = setTimeout(() => {
        if (!webrtcActive.current) {
          console.warn("WebRTC connect timeout (10s) — falling back to HTTP polling");
          cleanupWebRTC();
          setConnType("polling");
          markRoomActive();
        }
      }, 10000);

      // Handle candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          uploadIceCandidate(event.candidate);
        }
      };

      pc.onconnectionstatechange = () => {
        setWebrtcState(pc.connectionState);
        if (pc.connectionState === "connected") {
          webrtcActive.current = true;
          if (webrtcTimeoutRef.current) {
            clearTimeout(webrtcTimeoutRef.current);
            webrtcTimeoutRef.current = null;
          }
          setConnType("webrtc");
          markRoomActive();
        } else if (pc.connectionState === "failed") {
          // ICE failed outright — fall back AND activate the room so the game
          // can start via REST (US-PERF-21a); /active is idempotent server-side.
          webrtcActive.current = false;
          setConnType("polling");
          cleanupWebRTC();
          markRoomActive();
        } else if (pc.connectionState === "closed") {
          webrtcActive.current = false;
          setConnType("polling"); // Fallback
          cleanupWebRTC();
        }
      };

      // Set up initiator (Host) vs listener (Guest)
      if (isInitiator.current) {
        // Host creates data channel
        const dc = pc.createDataChannel("moves");
        dcRef.current = dc;
        setupDataChannel(dc);

        // Create offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        await fetch(`/api/battle/rooms/${roomCodeUpper}/signal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "host", sdpOffer: offer.sdp || "" })
        });
      } else {
        // Guest listens for data channel
        pc.ondatachannel = (event) => {
          dcRef.current = event.channel;
          setupDataChannel(event.channel);
        };
      }

      // Start signaling polling: kick one poll immediately (the opponent's offer is
      // usually already waiting — US-PERF-21c), then continue on the 1s interval.
      pollSignaling();
      signalPollInterval.current = setInterval(pollSignaling, 1000);

    } catch (err) {
      console.error("WebRTC initialization error:", err);
      setConnType("polling"); // Instantly fallback on error
    }
  };

  const setupDataChannel = (dc: RTCDataChannel) => {
    dc.onopen = () => {
      setWebrtcState("connected");
      webrtcActive.current = true;
      if (webrtcTimeoutRef.current) {
        clearTimeout(webrtcTimeoutRef.current);
        webrtcTimeoutRef.current = null;
      }
      setConnType("webrtc");
      markRoomActive();
      // Instantly clear signaling poll interval when connected
      if (signalPollInterval.current) {
        clearInterval(signalPollInterval.current);
        signalPollInterval.current = null;
      }
    };

    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "move") {
          // Instantly sync visual state
          setGameState(prev => {
            const nextBoard = [...prev.board];
            nextBoard[msg.cell - 1] = msg.player;
            return { board: nextBoard };
          });
          setCurrentTurn(msg.player === 1 ? 2 : 1);
        } else if (msg.type === "sync") {
          // Complete server-verified state synchronization (including turn deadline)
          setGameState(msg.gameState);
          setCurrentTurn(msg.currentTurn);
          setStatus(msg.status);
          setWinnerId(msg.winnerId);
          setFinishReason(msg.finishReason);
          setTurnDeadline(msg.turnDeadline);
        }
      } catch (err) {
        console.error("DataChannel read error:", err);
      }
    };

    dc.onclose = () => {
      webrtcActive.current = false;
      setConnType("polling");
    };
  };

  const pollSignaling = async () => {
    if (!isTabVisible) return;
    // In-flight guard: interval ticks and immediate kicks must not overlap,
    // or setRemoteDescription could run twice (US-PERF-21c)
    if (signalPollBusy.current) return;
    signalPollBusy.current = true;
    try {
      const res = await fetch(`/api/battle/rooms/${roomCodeUpper}/signal`);
      if (!res.ok) return;
      const data = await res.json();

      // Room status piggybacked on the 1s signaling channel (US-PERF-21b):
      // reflects "active" within ~1s instead of waiting for the state poll.
      if (data.roomStatus && data.roomStatus !== "waiting") {
        setStatus(prev => (prev === data.roomStatus ? prev : data.roomStatus));
      }

      const pc = pcRef.current;
      if (!pc) return;

      const myRole = isInitiator.current ? "host" : "guest";

      // 1. Process SDP
      if (myRole === "host" && data.sdpAnswer && pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: data.sdpAnswer }));
        // Process any queued candidates
        while (iceCandidatesQueue.current.length > 0) {
          const cand = iceCandidatesQueue.current.shift();
          await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(err => console.error(err));
        }
      } else if (myRole === "guest" && data.sdpOffer && pc.signalingState === "stable") {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: data.sdpOffer }));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        await fetch(`/api/battle/rooms/${roomCodeUpper}/signal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "guest", sdpAnswer: answer.sdp || "" })
        });

        // Re-poll right away: the host's ICE candidates are usually already
        // uploaded by now — don't wait for the next 1s tick (US-PERF-21c)
        setTimeout(() => pollSignaling(), 50);
      }

      // 2. Process ICE Candidates
      if (data.iceCandidates && Array.isArray(data.iceCandidates)) {
        for (const cand of data.iceCandidates) {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          } else {
            iceCandidatesQueue.current.push(cand);
          }
        }
      }
    } catch (err) {
      console.error("Signaling poll error:", err);
    } finally {
      signalPollBusy.current = false;
    }
  };

  const uploadIceCandidate = async (candidate: RTCIceCandidate) => {
    try {
      const myRole = isInitiator.current ? "host" : "guest";
      
      // Post singular candidate directly to be appended atomically by server
      await fetch(`/api/battle/rooms/${roomCodeUpper}/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: myRole,
          iceCandidate: candidate.toJSON()
        })
      });
    } catch (err) {
      console.error("Candidate upload failed:", err);
    }
  };

  const markRoomActive = async () => {
    try {
      await fetch(`/api/battle/rooms/${roomCodeUpper}/active`, { method: "POST" });
    } catch (err) {
      console.error("Failed to mark room as active:", err);
    }
  };

  const cleanupWebRTC = () => {
    if (webrtcTimeoutRef.current) {
      clearTimeout(webrtcTimeoutRef.current);
      webrtcTimeoutRef.current = null;
    }
    if (signalPollInterval.current) clearInterval(signalPollInterval.current);
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    webrtcActive.current = false;
  };

  // WebRTC Setup Orchestrator (separate lifecycle from status change cleanup, trigger on connecting).
  // Setup is deferred to a timeout so its state updates run outside the effect body.
  useEffect(() => {
    if (status === "connecting" && !webrtcActive.current && !pcRef.current) {
      const timer = setTimeout(() => setupWebRTC(), 0);
      return () => clearTimeout(timer);
    }
    if (status === "finished" || status === "expired") {
      cleanupWebRTC();
    }
  }, [status]);

  // Teardown everything strictly on unmount
  useEffect(() => {
    return () => {
      cleanupWebRTC();
    };
  }, []);

  // Submit Move Action
  const handlePlaceMark = async (cell: number) => {
    if (!myTurn || gameState.board[cell - 1] !== 0 || loading) return;

    // Zero latency UX: update local state first
    setGameState(prev => {
      const nextBoard = [...prev.board];
      nextBoard[cell - 1] = myNumber;
      return { board: nextBoard };
    });
    // Toggle turn indicator locally
    setCurrentTurn(myNumber === 1 ? 2 : 1);

    // Send via Data Channel if WebRTC is connected
    if (connType === "webrtc" && dcRef.current && dcRef.current.readyState === "open") {
      try {
        dcRef.current.send(JSON.stringify({
          type: "move",
          cell,
          player: myNumber,
        }));
      } catch (e) {
        console.error("Data channel send failed, falling back to REST confirm", e);
      }
    }

    // Submit to server to authorize and store in DB
    try {
      setLoading(true);
      const res = await fetch(`/api/battle/rooms/${roomCodeUpper}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cell })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || t.battleErrorMakeMove);
      }

      const freshData = await res.json();
      // Sync fresh server state
      setGameState(freshData.gameState);
      setCurrentTurn(freshData.currentTurn);
      setStatus(freshData.status);
      setWinnerId(freshData.winnerId);
      setFinishReason(freshData.finishReason);
      setTurnDeadline(freshData.turnDeadline);

      // Sync the fresh server-verified state to the opponent immediately via Data Channel
      if (connType === "webrtc" && dcRef.current && dcRef.current.readyState === "open") {
        try {
          dcRef.current.send(JSON.stringify({
            type: "sync",
            gameState: freshData.gameState,
            currentTurn: freshData.currentTurn,
            status: freshData.status,
            winnerId: freshData.winnerId,
            finishReason: freshData.finishReason,
            turnDeadline: freshData.turnDeadline
          }));
        } catch (e) {
          console.error("Failed to sync move status via data channel", e);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.battleErrorMoveVerification);
      // Rollback on error
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  // Resign
  const handleResign = async () => {
    const confirm = window.confirm(t.battleResignConfirm);
    if (!confirm) return;

    try {
      const res = await fetch(`/api/battle/rooms/${roomCodeUpper}/resign`, { method: "POST" });
      if (!res.ok) throw new Error(t.battleErrorResignFailed);
      const freshData = await res.json();
      setStatus(freshData.status);
      setWinnerId(freshData.winnerId);
      setFinishReason(freshData.finishReason);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.battleErrorResignFailed);
    }
  };

  // Helper formatting for house classes
  const getHouseColor = (houseId: string | null | undefined) => {
    switch (houseId?.toLowerCase()) {
      case "red": return "var(--red-house, #ef4444)";
      case "blue": return "var(--yellow-house, #3b82f6)";
      case "green": return "var(--blue-house, #22c55e)";
      case "yellow": return "var(--green-house, #94a3b8)";
      default: return "var(--text-secondary)";
    }
  };

  const getHouseName = (houseId: string | null | undefined) => {
    switch (houseId?.toLowerCase()) {
      case "red": return t.houseMom;
      case "blue": return t.houseLuang;
      case "green": return t.houseMakara;
      case "yellow": return t.houseTo;
      default: return "";
    }
  };

  // Render winning line highlighting helper
  const WIN_PATTERNS: [number, number, number][] = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  const getWinningLine = () => {
    if (status !== "finished" || !winnerId || finishReason !== "win") return null;
    const winningPlayerNum = winnerId === host?.id ? 1 : 2;
    return WIN_PATTERNS.find(([a, b, c]) =>
      gameState.board[a] === winningPlayerNum &&
      gameState.board[b] === winningPlayerNum &&
      gameState.board[c] === winningPlayerNum
    );
  };

  const winningLine = getWinningLine();

  return (
    <>
      <StudentNav />

      <main style={{ padding: "80px max(16px, env(safe-area-inset-right)) 80px max(16px, env(safe-area-inset-left))", maxWidth: 650, margin: "0 auto", width: "100%" }}>
        
        {/* Back link */}
        <div style={{ marginBottom: 20 }}>
          <Link href="/battle" style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none", color: "var(--text-secondary)", fontWeight: 600, fontSize: 14 }}>
            <ArrowLeft size={16} /> {t.battleLeaveGame}
          </Link>
        </div>

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fee2e2", padding: "12px 16px", borderRadius: "var(--radius-md)", color: "#991b1b", display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <AlertTriangle size={18} />
            <span style={{ fontSize: 14, fontWeight: 500 }}>{error}</span>
          </div>
        )}

        {/* 1. LOBBY PHASE (Waiting for player 2) */}
        {status === "waiting" && (
          <div className="glass" style={{ padding: 40, border: "1px solid var(--border-medium)", textAlign: "center" }}>
            <div style={{ display: "inline-flex", padding: 12, borderRadius: "50%", background: "var(--accent-glow)", color: "var(--accent-primary)", marginBottom: 20 }}>
              <Swords size={32} className="pulse" />
            </div>
            <h1 style={{ fontSize: "1.75rem", fontWeight: 900, marginBottom: 12 }}>{t.battleWaitingTitle}</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", maxWidth: 400, margin: "0 auto 16px" }}>
              {t.battleWaitingDesc}
            </p>
            {/* P2P privacy note (US-FIX-20i AC-2) */}
            <p style={{ display: "flex", alignItems: "flex-start", gap: 6, color: "var(--text-muted)", fontSize: "0.8rem", maxWidth: 400, margin: "0 auto 32px", textAlign: "left" }}>
              <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{t.battleP2pPrivacyNote}</span>
            </p>

            {/* QR Code */}
            <div style={{ background: "#fff", display: "inline-block", padding: 24, borderRadius: "var(--radius-lg)", boxShadow: "0 10px 25px -5px rgba(0,0,0,0.05)", border: "1px solid var(--border-subtle)", marginBottom: 24 }}>
              <QRCodeCanvas
                value={`${typeof window !== "undefined" ? window.location.origin : ""}/battle/join?room=${roomCodeUpper}`}
                size={220}
                level="M"
                bgColor="#ffffff"
                fgColor="#000000"
              />
            </div>

            {/* Room Code */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.05em" }}>{t.battleRoomCodeLabel}</span>
              <div style={{ fontSize: "2.25rem", fontWeight: 900, color: "var(--accent-primary)", border: "2px dashed var(--accent-primary)", padding: "8px 24px", borderRadius: "var(--radius-md)", letterSpacing: "0.1em", background: "var(--accent-glow)" }}>
                {roomCodeUpper}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--text-secondary)", fontSize: 14, marginTop: 32 }}>
              <Loader2 size={16} className="spinner" />
              <span>{t.battleWaitingOpponent}</span>
            </div>
          </div>
        )}

        {/* 2. CONNECTING PHASE (Signaling / ICE Candidate Exchange) */}
        {status === "connecting" && (
          <div className="glass" style={{ padding: 40, border: "1px solid var(--border-medium)", textAlign: "center" }}>
            <div style={{ display: "inline-flex", padding: 16, borderRadius: "50%", background: "rgba(59, 130, 246, 0.1)", color: "#3b82f6", marginBottom: 20 }}>
              <Loader2 size={36} className="spinner" />
            </div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: 8 }}>{t.battleConnectingTitle}</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", maxWidth: 400, margin: "0 auto 16px" }}>
              {t.battleConnectingDesc}
            </p>
            <div style={{ fontSize: 13, padding: "8px 16px", borderRadius: 20, background: "var(--bg-elevated)", color: "var(--text-secondary)", display: "inline-block" }}>
              {t.battleWebrtcStatusLabel} <span style={{ fontWeight: 700, color: "#3b82f6" }}>{webrtcState.toUpperCase()}</span>
            </div>

            <div style={{ marginTop: 24, fontSize: 12, color: "var(--text-muted)" }}>
              {t.battleConnectingFallbackNote}
            </div>
          </div>
        )}

        {/* 3. ACTIVE GAME & RESULT PHASES */}
        {(status === "active" || status === "finished") && (
          <div>
            {/* Player Info Card Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-surface)", border: "1px solid var(--border-medium)", padding: 16, borderRadius: "var(--radius-lg)", marginBottom: 20, boxShadow: "0 4px 6px -1px rgba(0,0,0,0.01)" }}>
              {/* Host/X Profile */}
              {host && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                  <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--bg-elevated)", border: `3px solid ${getHouseColor(host.houseId)}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "var(--accent-primary)", fontSize: 18 }}>
                    X
                  </div>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: 14 }}>{host.nickname || host.name}</p>
                    <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{getHouseName(host.houseId)}</p>
                  </div>
                </div>
              )}

              {/* VERSUS middle & TIMER */}
              <div style={{ textAlign: "center", padding: "0 16px" }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", display: "block" }}>VS</span>
                {status === "active" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, background: timeLeft <= 15 ? "rgba(239, 68, 68, 0.1)" : "var(--accent-glow)", padding: "4px 10px", borderRadius: 12, color: timeLeft <= 15 ? "#ef4444" : "var(--accent-primary)", fontWeight: 700, fontSize: 14 }}>
                    <Hourglass size={14} className={timeLeft <= 15 ? "pulse" : ""} />
                    <span>{timeLeft}s</span>
                  </div>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>{t.battleGameOverLabel}</span>
                )}
              </div>

              {/* Guest/O Profile */}
              {guest ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, justifyContent: "flex-end", textAlign: "right" }}>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: 14 }}>{guest.nickname || guest.name}</p>
                    <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{getHouseName(guest.houseId)}</p>
                  </div>
                  <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--bg-elevated)", border: `3px solid ${getHouseColor(guest.houseId)}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#3b82f6", fontSize: 18 }}>
                    O
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, textAlign: "right", color: "var(--text-muted)", fontSize: 13 }}>{t.battleWaitingPlayerLabel}</div>
              )}
            </div>

            {/* Turn Status banner */}
            {status === "active" && (
              <div style={{
                textAlign: "center",
                padding: "8px 16px",
                borderRadius: "var(--radius-md)",
                background: myTurn ? "rgba(34, 197, 94, 0.08)" : "var(--bg-elevated)",
                border: "1px solid " + (myTurn ? "rgba(34, 197, 94, 0.2)" : "var(--border-subtle)"),
                color: myTurn ? "#16a34a" : "var(--text-secondary)",
                fontWeight: 700,
                fontSize: 14,
                marginBottom: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8
              }}>
                {myTurn ? (
                  <>
                    <Zap size={16} className="pulse" />
                    <span>{t.battleYourTurnMsg}</span>
                  </>
                ) : (
                  <span>{t.battleOpponentTurnMsg}</span>
                )}
              </div>
            )}

            {/* CONNECTION TYPE OVERLAY indicator */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px 12px", fontSize: 12 }}>
              <span style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                {t.battleConnTypeLabel}
                <span style={{ fontWeight: 700, color: connType === "webrtc" ? "#22c55e" : "#f59e0b" }}>
                  {connType === "webrtc" ? t.battleConnTypeWebrtc : t.battleConnTypePolling}
                </span>
              </span>
              <span style={{ color: "var(--text-muted)" }}>
                {t.battleRoomCodeShortLabel} <span style={{ fontWeight: 700 }}>{roomCodeUpper}</span>
              </span>
            </div>

            {/* 3x3 OX BOARD GRID */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
              background: "var(--border-medium)",
              padding: 12,
              borderRadius: "var(--radius-xl)",
              border: "1px solid var(--border-subtle)",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.05)",
              aspectRatio: "1/1",
              width: "100%",
              boxSizing: "border-box",
              position: "relative",
            }}>
              {gameState.board.map((cellValue, idx) => {
                const cellIndex = idx;
                const isCellWinning = winningLine && winningLine.includes(cellIndex);
                
                return (
                  <button
                    key={idx}
                    onClick={() => handlePlaceMark(cellIndex + 1)}
                    disabled={!myTurn || cellValue !== 0}
                    className={`ox-cell ${cellValue === 0 && myTurn ? "hover-preview" : ""}`}
                    style={{
                      border: "none",
                      outline: "none",
                      borderRadius: "var(--radius-lg)",
                      background: isCellWinning ? "var(--accent-glow)" : "var(--bg-surface)",
                      boxShadow: isCellWinning ? "0 0 15px var(--accent-glow)" : "none",
                      borderWidth: isCellWinning ? 2 : 0,
                      borderColor: isCellWinning ? "var(--accent-primary)" : "transparent",
                      cursor: (myTurn && cellValue === 0 && status === "active") ? "pointer" : "default",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.18s ease-in-out",
                      position: "relative",
                    }}
                  >
                    {/* Render Marks */}
                    {cellValue === 1 && (
                      <svg width="60%" height="60%" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="4.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    )}

                    {cellValue === 2 && (
                      <svg width="62%" height="62%" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="4.5">
                        <circle cx="12" cy="12" r="9"></circle>
                      </svg>
                    )}

                    {/* My Turn Preview symbol on hover */}
                    {cellValue === 0 && myTurn && status === "active" && (
                      <div className="preview-symbol" style={{ opacity: 0, transition: "opacity 0.15s" }}>
                        {myNumber === 1 ? (
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent-glow)" strokeWidth="3" strokeLinecap="round" style={{ stroke: "rgba(255, 107, 0, 0.25)" }}>
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                        ) : (
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(59, 130, 246, 0.25)" strokeWidth="3">
                            <circle cx="12" cy="12" r="9"></circle>
                          </svg>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Active Control Bar */}
            {status === "active" && (
              <div style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
                <button
                  className="btn"
                  onClick={handleResign}
                  style={{
                    background: "#ef4444",
                    color: "#fff",
                    height: 48,
                    fontWeight: 700,
                    padding: "0 32px"
                  }}
                >
                  <LogOut size={16} style={{ marginRight: 8 }} />
                  {t.battleResignBtn}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 4. PREMIUM RESULT MODAL/CARD */}
        {status === "finished" && (
          <div className="glass" style={{
            marginTop: 32,
            padding: 32,
            border: "2px solid var(--border-medium)",
            textAlign: "center",
            boxShadow: "0 15px 30px rgba(0,0,0,0.1)",
            background: "linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-elevated) 100%)",
            borderRadius: "var(--radius-xl)"
          }}>
            {winnerId ? (
              winnerId === user?.id ? (
                <div>
                  <div style={{ display: "inline-flex", padding: 16, borderRadius: "50%", background: "rgba(34, 197, 94, 0.1)", color: "#22c55e", marginBottom: 16 }}>
                    <Award size={48} className="pulse" />
                  </div>
                  <h2 style={{ fontSize: "2rem", fontWeight: 900, color: "#22c55e", marginBottom: 8, letterSpacing: "-0.03em", display: "inline-flex", alignItems: "center", gap: 10 }}>
                    <PartyPopper size={28} /> {t.battleWinTitle}
                  </h2>
                  <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
                    {finishReason === "forfeit" ? t.battleWinReasonForfeit : t.battleWinReasonNormal}
                  </p>
                </div>
              ) : (
                <div>
                  <div style={{ display: "inline-flex", padding: 16, borderRadius: "50%", background: "rgba(239, 68, 68, 0.1)", color: "#ef4444", marginBottom: 16 }}>
                    <AlertTriangle size={48} />
                  </div>
                  <h2 style={{ fontSize: "2rem", fontWeight: 900, color: "#ef4444", marginBottom: 8, letterSpacing: "-0.03em", display: "inline-flex", alignItems: "center", gap: 10 }}>
                    <Frown size={28} /> {t.battleLoseTitle}
                  </h2>
                  <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
                    {finishReason === "forfeit" ? t.battleLoseReasonForfeit : t.battleLoseReasonNormal}
                  </p>
                </div>
              )
            ) : (
              <div>
                <div style={{ display: "inline-flex", padding: 16, borderRadius: "50%", background: "rgba(107, 114, 128, 0.1)", color: "var(--text-secondary)", marginBottom: 16 }}>
                  <RotateCcw size={48} />
                </div>
                <h2 style={{ fontSize: "2rem", fontWeight: 900, color: "var(--text-secondary)", marginBottom: 8, letterSpacing: "-0.03em", display: "inline-flex", alignItems: "center", gap: 10 }}>
                  <Handshake size={28} /> {t.battleDrawTitle}
                </h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
                  {t.battleDrawDesc}
                </p>
              </div>
            )}

            <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 32 }}>
              <Link href="/battle" className="btn" style={{ background: "var(--text-primary)", color: "#fff", height: 48, padding: "0 24px" }}>
                {t.battleBackToArenaHomeBtn}
              </Link>
              <button
                className="btn"
                onClick={() => {
                  cleanupWebRTC();
                  router.push("/battle/create");
                }}
                style={{ background: "var(--accent-primary)", color: "#fff", height: 48, padding: "0 24px" }}
              >
                {t.battleRematchBtn}
              </button>
            </div>
          </div>
        )}

      </main>

      {/* Styled custom classes injected */}
      <style jsx global>{`
        .ox-cell:hover:not(:disabled) {
          background: var(--bg-glass) !important;
          transform: scale(1.03);
          box-shadow: 0 4px 12px rgba(0,0,0,0.03);
        }
        .ox-cell:active:not(:disabled) {
          transform: scale(0.98);
        }
        .ox-cell.hover-preview:hover .preview-symbol {
          opacity: 1 !important;
        }
        .pulse {
          animation: pulseAnim 2s infinite;
        }
        @keyframes pulseAnim {
          0% { transform: scale(1); }
          50% { transform: scale(1.08); }
          100% { transform: scale(1); }
        }
      `}</style>
    </>
  );
}
