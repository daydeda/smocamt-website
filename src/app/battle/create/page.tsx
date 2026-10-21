"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Swords } from "lucide-react";
import { StudentNav } from "@/components/layout/StudentNav";
import { useLanguage } from "@/lib/i18n/LanguageContext";

export default function CreateRoomPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function create() {
      try {
        const res = await fetch("/api/battle/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameType: "ox" }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || t.battleErrorCreateRoom);
        }

        const room = await res.json();
        router.replace(`/battle/room/${room.roomCode}`);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : t.battleErrorUnexpected);
      }
    }
    create();
  }, [router, t]);

  return (
    <>
      <StudentNav />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "80vh", padding: "80px 24px", textAlign: "center" }}>
        {error ? (
          <div style={{ background: "var(--error-bg)", border: "1px solid var(--error-border)", padding: "24px", borderRadius: "var(--radius-lg)", color: "var(--error-text)", maxWidth: 400 }}>
            <h2 style={{ fontWeight: 700, marginBottom: 8, fontSize: "1.25rem" }}>{t.battleCreateErrorTitle}</h2>
            <p style={{ fontSize: 14 }}>{error}</p>
            <button className="btn" style={{ background: "var(--text-primary)", color: "var(--text-on-color)", marginTop: 16 }} onClick={() => router.push("/battle")}>
              {t.battleBackToArenaBtn}
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ display: "inline-flex", padding: 16, borderRadius: "50%", background: "var(--accent-glow)", color: "var(--accent-primary)", marginBottom: 20 }}>
              <Swords size={40} className="pulse" />
            </div>
            <div className="spinner" style={{ marginBottom: 16 }}></div>
            <h2 style={{ fontWeight: 700, fontSize: "1.25rem", color: "var(--text-primary)" }}>{t.battleCreatingRoomPageTitle}</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginTop: 4 }}>{t.battleReservingSessionDesc}</p>
          </div>
        )}
      </div>
    </>
  );
}
