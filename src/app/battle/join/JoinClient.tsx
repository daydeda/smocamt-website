"use client";

import { StudentNav } from "@/components/layout/StudentNav";
import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Html5Qrcode } from "html5-qrcode";
import { Swords, Camera, AlertTriangle, ArrowLeft, Loader2, CameraOff, Info } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/lib/LanguageContext";

interface JoinClientProps {
  initialSession: { user: { id: string; name?: string | null } } | null;
}

export function JoinClient({ initialSession }: JoinClientProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const queryRoom = searchParams.get("room") || "";

  const [code, setCode] = useState<string[]>(["", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  // Scanner state
  const [isScanning, setIsScanning] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isMountedRef = useRef(true);

  const inputRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  const stopScanner = () => {
    setIsScanning(false);
  };

  const handleJoinRoom = async (roomCode: string) => {
    if (roomCode.length !== 4) return;
    setLoading(true);
    setError(null);
    stopScanner();

    try {
      const res = await fetch(`/api/battle/rooms/${roomCode}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || t.battleErrorJoinRoom);
      }

      router.push(`/battle/room/${roomCode}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.battleErrorJoinRoomFallback);
      setLoading(false);
    }
  };

  // Lifecycle
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopScanner();
    };
  }, []);

  // Pre-fill room code if provided in query URL (deferred so no sync setState in effect)
  useEffect(() => {
    if (!queryRoom || queryRoom.length !== 4) return;
    const timer = setTimeout(() => {
      setCode(queryRoom.toUpperCase().split(""));
      handleJoinRoom(queryRoom.toUpperCase());
    }, 0);
    return () => clearTimeout(timer);
  }, [queryRoom]);

  // Handles input typing inside the character blocks
  const handleInputChange = (index: number, val: string) => {
    const newVal = val.toUpperCase().replace(/[^A-Z2-9]/g, ""); // Filter to allowed characters
    if (!newVal) {
      const nextCode = [...code];
      nextCode[index] = "";
      setCode(nextCode);
      return;
    }

    const nextCode = [...code];
    nextCode[index] = newVal[newVal.length - 1]; // Use last char typed
    setCode(nextCode);

    // Auto-focus next input
    if (index < 3 && newVal.length > 0) {
      inputRefs[index + 1].current?.focus();
    }

    // Auto-submit if full
    const fullCode = nextCode.join("");
    if (fullCode.length === 4 && index === 3) {
      handleJoinRoom(fullCode);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    // Backspace: clear and move back
    if (e.key === "Backspace") {
      if (code[index] === "" && index > 0) {
        const nextCode = [...code];
        nextCode[index - 1] = "";
        setCode(nextCode);
        inputRefs[index - 1].current?.focus();
      } else {
        const nextCode = [...code];
        nextCode[index] = "";
        setCode(nextCode);
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData("text").trim().toUpperCase();
    if (pastedText.length >= 4) {
      const cleanText = pastedText.replace(/[^A-Z2-9]/g, "").substring(0, 4);
      if (cleanText.length === 4) {
        const chars = cleanText.split("");
        setCode(chars);
        handleJoinRoom(cleanText);
      }
    }
  };

  // Start/stop scanner when isScanning changes (avoids race condition where container element is not in DOM yet)
  useEffect(() => {
    if (!isScanning) {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {}).finally(() => {
          scannerRef.current = null;
        });
      }
      return;
    }

    let isCurrentEffect = true;
    let activeScanner: Html5Qrcode | null = null;

    const initScanner = async () => {
      // 1. Check navigator/camera API
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        if (isCurrentEffect) {
          setScannerError(t.battleErrorCameraUnavailable);
          setIsScanning(false);
        }
        return;
      }

      // 2. Ensure container is present in DOM
      const container = document.getElementById("join-qr-reader");
      if (!container) {
        // Retry once on next frame in case React render is still committing
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }

      const verifiedContainer = document.getElementById("join-qr-reader");
      if (!verifiedContainer) {
        if (isCurrentEffect) {
          setScannerError(t.battleErrorCameraContainerMissing);
          setIsScanning(false);
        }
        return;
      }

      verifiedContainer.innerHTML = "";

      // 3. Initialize Html5Qrcode
      try {
        const scanner = new Html5Qrcode("join-qr-reader");
        scannerRef.current = scanner;
        activeScanner = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText) => {
            if (!isCurrentEffect) return;
            try {
              const url = new URL(decodedText);
              const roomVal = url.searchParams.get("room");
              if (roomVal && roomVal.length === 4) {
                setIsScanning(false); // triggers effect cleanup
                const chars = roomVal.toUpperCase().split("");
                setCode(chars);
                handleJoinRoom(roomVal.toUpperCase());
              } else {
                setScannerError(t.battleErrorInvalidQrContent);
              }
            } catch {
              const cleanText = decodedText.trim().toUpperCase().replace(/[^A-Z2-9]/g, "");
              if (cleanText.length === 4) {
                setIsScanning(false); // triggers effect cleanup
                const chars = cleanText.split("");
                setCode(chars);
                handleJoinRoom(cleanText);
              } else {
                setScannerError(t.battleErrorQrReadFailed);
              }
            }
          },
          () => {}
        );
      } catch (err: unknown) {
        console.error(err);
        if (isCurrentEffect) {
          let msg = t.battleErrorCameraInitFailed;
          if (err instanceof Error && (err.name === "NotAllowedError" || /permission/i.test(err.message))) {
            msg = t.battleErrorCameraPermissionDenied;
          }
          setScannerError(msg);
          setIsScanning(false);
          scannerRef.current = null;
        }
      }
    };

    initScanner();

    return () => {
      isCurrentEffect = false;
      if (activeScanner) {
        activeScanner.stop().catch(() => {});
      }
    };
  }, [isScanning, t]);

  const startScanner = () => {
    setError(null);
    setScannerError(null);
    setIsScanning(true);
  };

  const currentCode = code.join("");

  return (
    <>
      <StudentNav />

      <main style={{ padding: "80px max(16px, env(safe-area-inset-right)) 80px max(16px, env(safe-area-inset-left))", maxWidth: 600, margin: "0 auto", width: "100%" }}>
        {/* Back Button */}
        <div style={{ marginBottom: 20 }}>
          <Link href="/battle" style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none", color: "var(--text-secondary)", fontWeight: 600, fontSize: 14 }}>
            <ArrowLeft size={16} /> {t.battleBackToArenaBtn}
          </Link>
        </div>

        {/* Card Panel */}
        <div className="glass" style={{ padding: 40, border: "1px solid var(--border-medium)" }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ display: "inline-flex", padding: 12, borderRadius: "50%", background: "rgb(var(--blue-500-rgb) / 0.1)", color: "var(--blue-500)", marginBottom: 16 }}>
              <Swords size={28} />
            </div>
            <h1 style={{ fontSize: "1.75rem", fontWeight: 900, marginBottom: 8, letterSpacing: "-0.03em" }}>
              {t.battleJoinRoomTitle}
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
              {t.battleJoinRoomDesc}
            </p>
            {/* P2P privacy note (US-FIX-20i AC-2) */}
            <p style={{ display: "flex", alignItems: "flex-start", gap: 6, color: "var(--text-muted)", fontSize: "0.8rem", marginTop: 12, textAlign: "left" }}>
              <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{t.battleP2pPrivacyNote}</span>
            </p>
          </div>

          {/* Form */}
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* 4 Block Input */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>{t.battleTypeRoomCodeLabel}</label>
              
              <div style={{ display: "flex", gap: 12 }}>
                {code.map((char, index) => (
                  <input
                    key={index}
                    ref={inputRefs[index]}
                    type="text"
                    maxLength={1}
                    value={char}
                    onChange={(e) => handleInputChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    onPaste={index === 0 ? handlePaste : undefined}
                    disabled={loading}
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: "var(--radius-md)",
                      border: "2px solid var(--border-medium)",
                      fontSize: 24,
                      fontWeight: 900,
                      textAlign: "center",
                      textTransform: "uppercase",
                      outline: "none",
                      background: "var(--bg-elevated)",
                      transition: "border-color 0.15s, box-shadow 0.15s",
                      boxShadow: char ? "0 0 0 2px var(--accent-glow)" : "none",
                      borderColor: char ? "var(--accent-primary)" : "var(--border-medium)",
                    }}
                    onFocus={(e) => e.target.select()}
                  />
                ))}
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div style={{ background: "var(--error-bg)", border: "1px solid var(--error-border)", padding: "12px 16px", borderRadius: "var(--radius-md)", color: "var(--error-text)", display: "flex", alignItems: "center", gap: 10 }}>
                <AlertTriangle size={18} />
                <span style={{ fontSize: 14, fontWeight: 500 }}>{error}</span>
              </div>
            )}

            {/* Join Button */}
            <button
              className="btn"
              disabled={loading || currentCode.length !== 4}
              onClick={() => handleJoinRoom(currentCode)}
              style={{
                background: currentCode.length === 4 ? "var(--accent-primary)" : "var(--text-muted)",
                color: "var(--text-on-color)",
                height: 52,
                fontSize: 16,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8
              }}
            >
              {loading ? (
                <>
                  <Loader2 className="spinner" size={20} />
                  {t.battleJoiningRoomBtn}
                </>
              ) : (
                t.battleJoinRoomTitle
              )}
            </button>

            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "12px 0" }}>
              <div style={{ flexGrow: 1, height: 1, background: "var(--border-subtle)" }}></div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>{t.battleOrDivider}</span>
              <div style={{ flexGrow: 1, height: 1, background: "var(--border-subtle)" }}></div>
            </div>

            {/* Scan Camera Area */}
            {!isScanning ? (
              <button
                className="btn"
                onClick={startScanner}
                disabled={loading}
                style={{
                  border: "2px solid var(--border-medium)",
                  background: "transparent",
                  color: "var(--text-primary)",
                  height: 48,
                  fontSize: 14,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8
                }}
              >
                <Camera size={18} />
                {t.battleScanQrCameraBtn}
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
                <div 
                  id="join-qr-reader" 
                  style={{ 
                    width: "100%", 
                    maxWidth: 320, 
                    borderRadius: "var(--radius-lg)", 
                    overflow: "hidden", 
                    border: "2px solid var(--accent-primary)",
                    background: "var(--black)"
                  }}
                ></div>
                
                {scannerError && (
                  <div style={{ background: "var(--warn-bg)", border: "1px solid var(--warn-border)", padding: "10px 12px", borderRadius: "var(--radius-md)", color: "var(--warn-text)", fontSize: 13 }}>
                    {scannerError}
                  </div>
                )}

                <button
                  className="btn"
                  onClick={stopScanner}
                  style={{
                    background: "var(--red-500)",
                    color: "var(--text-on-color)",
                    height: 40,
                    fontSize: 13,
                    padding: "0 16px"
                  }}
                >
                  <CameraOff size={16} style={{ marginRight: 6 }} />
                  {t.battleStopScannerBtn}
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
