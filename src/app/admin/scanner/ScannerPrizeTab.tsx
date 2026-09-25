"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Gift, QrCode, Loader2, PackageOpen, ImageOff, ArrowRight } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import PrizeAwardPanel from "../prizes/PrizeAwardPanel";

// The scanner's "Prize" tab — a booth shortcut so staff running check-in don't
// have to leave the scanner to hand out prizes. It is ONLY a picker: awarding
// goes through the same PrizeAwardPanel (and the same /api/admin/prizes routes,
// scoping and anti-duplicate index) as /admin/prizes. See
// docs/features/prize-claim.md.
//
// The parent scanner page stops its own camera while this tab is active —
// PrizeAwardPanel starts its own html5-qrcode instance and two can't share the
// camera.

interface PrizeRow {
  id: string;
  name: string;
  eventId: string | null;
  eligibilityEventId: string | null;
  quantity: number | null;
  onePerStudent: boolean;
  requireCheckIn: boolean;
  status: "open" | "closed";
  claimCount?: number;
  awaitingPhotoCount?: number;
}

export default function ScannerPrizeTab({ eventId, eventTitle }: { eventId: string; eventTitle: string | null }) {
  const { t } = useLanguage();
  const [prizes, setPrizes] = useState<PrizeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [awarding, setAwarding] = useState<PrizeRow | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/prizes");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPrizes(data.prizes ?? []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred so the setState calls land after this render commits
    // (react-hooks/set-state-in-effect) — same as PrizesClient.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const open = prizes.filter((p) => p.status === "open");
  // "This event" = linked to it OR gated on checking in to it — both mean staff
  // at this event's booth are the ones handing it out.
  const forEvent = eventId ? open.filter((p) => p.eventId === eventId || p.eligibilityEventId === eventId) : [];
  const other = open.filter((p) => !forEvent.includes(p));

  const renderPrize = (p: PrizeRow) => {
    const overQuantity = p.quantity !== null && (p.claimCount ?? 0) > p.quantity;
    return (
      <li key={p.id} className="stat-card" style={{ padding: "16px 18px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0, flex: "1 1 200px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)", overflowWrap: "break-word" }}>{p.name}</h3>
              {p.onePerStudent && <span className="badge badge-blue">{t.adminPrizesOnePerStudentBadge}</span>}
              {p.requireCheckIn && <span className="badge badge-purple">{t.adminPrizesRequireCheckInBadge}</span>}
            </div>
            <p style={{ marginTop: 6, fontSize: 13, color: "var(--text-secondary)" }}>
              {p.quantity !== null
                ? t.adminPrizesAwardedCountWithTarget.replace("{count}", String(p.claimCount ?? 0)).replace("{target}", String(p.quantity))
                : t.adminPrizesAwardedCount.replace("{count}", String(p.claimCount ?? 0))}
              {overQuantity && <span style={{ marginLeft: 8, fontWeight: 700, color: "#b45309" }}>{t.adminPrizesOverQuantity}</span>}
              {!!p.awaitingPhotoCount && (
                <span style={{ marginLeft: 8, display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 700, color: "#b45309" }}>
                  <ImageOff size={13} /> {t.adminPrizesAwaitingPhoto.replace("{count}", String(p.awaitingPhotoCount))}
                </span>
              )}
            </p>
          </div>
          <button className="btn btn-success-solid" style={{ minHeight: 48 }} onClick={() => setAwarding(p)}>
            <QrCode size={16} /> {t.adminPrizesAwardBtn}
          </button>
        </div>
      </li>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="stat-card" style={{ padding: "18px 20px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <p style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 700, color: "var(--text-secondary)" }}>
          <Gift size={20} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
          {t.scannerPrizeHint}
        </p>
        <Link href="/admin/prizes" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--accent-primary)" }}>
          {t.scannerPrizeManageLink} <ArrowRight size={14} />
        </Link>
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "48px 0", color: "var(--text-muted)", fontSize: 14 }}>
          <Loader2 size={18} className="animate-spin" /> {t.adminPrizesLoading}
        </div>
      ) : error ? (
        <div className="stat-card" style={{ textAlign: "center", padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <p style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)" }}>{t.scannerPrizeLoadError}</p>
          <button className="btn btn-ghost" onClick={() => { setLoading(true); void load(); }}>{t.scannerPrizeRetry}</button>
        </div>
      ) : open.length === 0 ? (
        <div className="stat-card" style={{ textAlign: "center", padding: "56px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <PackageOpen size={40} style={{ color: "var(--text-muted)" }} />
          <p style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)" }}>{t.scannerPrizeNoOpen}</p>
        </div>
      ) : (
        <>
          {forEvent.length > 0 && (
            <section>
              <h2 style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", marginBottom: 10, overflowWrap: "break-word" }}>
                {t.scannerPrizeThisEvent.replace("{event}", eventTitle ?? "")}
              </h2>
              <ul style={{ display: "flex", flexDirection: "column", gap: 12, listStyle: "none" }}>{forEvent.map(renderPrize)}</ul>
            </section>
          )}
          {other.length > 0 && (
            <section>
              <h2 style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>
                {t.scannerPrizeOther}
              </h2>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, marginBottom: 10 }}>{t.scannerPrizeOtherHint}</p>
              <ul style={{ display: "flex", flexDirection: "column", gap: 12, listStyle: "none" }}>{other.map(renderPrize)}</ul>
            </section>
          )}
        </>
      )}

      {awarding && (
        <PrizeAwardPanel
          prizeId={awarding.id}
          prizeName={awarding.name}
          onClaimed={load}
          onClose={() => setAwarding(null)}
        />
      )}
    </div>
  );
}
