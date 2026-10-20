"use client";

import { useState, useEffect } from "react";

const RETRY_SECS = 30; // retry delay when the token endpoint is unreachable

export function useQrToken(userId: string | undefined) {
  const [qrValue, setQrValue] = useState<string>("loading");
  const [secsLeft, setSecsLeft] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    // Tokens are pinned to fixed 5-min windows server-side, so we refetch just
    // after the window rolls — the countdown shows true remaining validity and
    // a page refresh mid-window returns the same QR without resetting it.
    const fetchToken = async () => {
      try {
        const res = await fetch("/api/qr-token");
        if (res.ok) {
          const { token, expiresIn } = await res.json();
          if (cancelled) return;
          setQrValue(token);
          setSecsLeft(expiresIn);
          timer = setTimeout(fetchToken, expiresIn * 1000 + 500);
          return;
        }
      } catch {
        // fall through to retry
      }
      if (cancelled) return;
      setQrValue(userId); // legacy fallback: scanner resolves raw user IDs
      setSecsLeft(RETRY_SECS);
      timer = setTimeout(fetchToken, RETRY_SECS * 1000);
    };

    fetchToken();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userId]);

  // Countdown ticks every second; resets when qrValue changes
  useEffect(() => {
    if (qrValue === "loading") return;
    const tick = setInterval(() => setSecsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(tick);
  }, [qrValue]);

  const countdownMM = String(Math.floor(secsLeft / 60)).padStart(2, "0");
  const countdownSS = String(secsLeft % 60).padStart(2, "0");
  const countdownColor =
    secsLeft > 60 ? "var(--green-500)" : secsLeft > 30 ? "var(--amber-500)" : "var(--red-500)";

  return { qrValue, secsLeft, countdownMM, countdownSS, countdownColor };
}
