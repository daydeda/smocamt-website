"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Users, Trophy, ShieldAlert, Crown, MessageCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { StudentNav } from "@/components/layout/StudentNav";
import { alpha } from "@/lib/ui/color";

// Shared LINE group everyone joins (same group on the rankings page and every
// house page).
const LINE_GROUP_URL =
  "https://line.me/ti/g2/82BVV3y9-l4YuhV5uqFWNMY52Dqg42ZpvYYNFQ?utm_source=invitation&utm_medium=link_copy&utm_campaign=default";

// House mascot logos, keyed by house id (color) and name — mirrors the leaderboard
// page so the same artwork resolves whichever identifier the API returns.
const HOUSE_LOGOS: Record<string, string> = {
  red: "/house_logo/mom.png",    mom: "/house_logo/mom.png",
  green: "/house_logo/to.png",   to: "/house_logo/to.png",
  yellow: "/house_logo/luang.png", luang: "/house_logo/luang.png",
  blue: "/house_logo/makon.png", makara: "/house_logo/makon.png", makon: "/house_logo/makon.png",
};
const houseLogo = (idOrName?: string | null): string | null =>
  idOrName ? HOUSE_LOGOS[idOrName.toLowerCase()] ?? null : null;

type House = { id: string; name: string; color: string; points: number };
type Member = { id: string; name: string; nickname: string | null; points: number };

export default function HouseMembersPage() {
  const { t, lang } = useLanguage();
  const { data: session } = useSession();
  const myId = session?.user?.id;
  const params = useParams();
  const houseId = String(params.houseId);

  const [house, setHouse] = useState<House | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  // 403 → trying to view a house that isn't yours; anything else → generic failure.
  const [error, setError] = useState<"forbidden" | "other" | null>(null);

  const getTranslatedHouseName = (idOrName: string, defaultName: string) => {
    const key = idOrName.toLowerCase();
    if (key === "red" || key === "mom") return t.houseMom || "Mom";
    if (key === "green" || key === "to") return t.houseTo || "To";
    if (key === "yellow" || key === "luang") return t.houseLuang || "Luang";
    if (key === "blue" || key === "makara") return t.houseMakara || "Makon";
    return defaultName;
  };

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/houses/${houseId}/members`, { signal: ac.signal })
      .then(async (r) => {
        if (r.status === 403) { setError("forbidden"); return null; }
        if (!r.ok) { setError("other"); return null; }
        return r.json();
      })
      .then((data) => {
        if (data) {
          setHouse(data.house);
          setMembers(data.members ?? []);
        }
      })
      .catch((e) => { if (e.name !== "AbortError") setError("other"); })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [houseId]);

  if (loading) {
    return (
      <div style={{ background: "var(--bg-base)", minHeight: "100vh" }}>
        <StudentNav />
        <div className="min-h-screen flex items-center justify-center">
          <div className="spinner" style={{ width: 32, height: 32 }} />
        </div>
      </div>
    );
  }

  if (error || !house) {
    return (
      <div style={{ background: "var(--bg-base)", minHeight: "100vh" }}>
        <StudentNav />
        <main className="page-container" style={{ marginTop: 40 }}>
          <div className="notice-card">
            <ShieldAlert size={40} style={{ color: "var(--text-muted)" }} />
            <p>{error === "forbidden" ? t.membersOwnHouseOnly : "Something went wrong."}</p>
          </div>
        </main>
        <style jsx>{noticeStyles}</style>
      </div>
    );
  }

  const color = house.color || "var(--accent-primary)";
  const displayName = getTranslatedHouseName(house.id, house.name);
  const logo = houseLogo(house.id);
  const maxPoints = Math.max(...members.map((m) => m.points), 1);

  // Pagination — 50 members per page. The top-3 podium only renders on page 1
  // (and counts toward that page's 50), so page 1 shows podium + ranks 4–50.
  const itemsPerPage = 50;
  const totalPages = Math.max(1, Math.ceil(members.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;

  const podium = currentPage === 1 ? members.slice(0, 3) : [];
  // Skip the podium's top 3 on page 1; later pages list their full 50-slice.
  const listStart = currentPage === 1 ? 3 : startIndex;
  const rest = members.slice(listStart, startIndex + itemsPerPage);
  // Podium visual order: 2nd, 1st, 3rd (center-tallest), matching the leaderboard.
  const podiumOrder = [podium[1], podium[0], podium[2]];
  const placeClass = ["second-place", "first-place", "third-place"];
  const rankNum = [2, 1, 3];

  return (
    <div style={{ background: "var(--bg-base)", minHeight: "100vh", paddingBottom: 80 }}>
      <StudentNav />

      <main className="page-container" style={{ marginTop: 32 }}>
        {/* Hero banner — house colour wash + mascot */}
        <header
          className="house-hero"
          style={{
            background: `linear-gradient(135deg, ${alpha(color, 0.12)} 0%, ${alpha(color, 0.03)} 55%, var(--bg-surface) 100%)`,
            borderColor: alpha(color, 0.25),
          }}
        >
          <div className="hero-glow" style={{ background: color }} />
          <div className="hero-avatar" style={{ background: alpha(color, 0.08), boxShadow: `0 16px 40px ${alpha(color, 0.2)}` }}>
            {logo ? <img src={logo} alt="" className="hero-logo-img" /> : <Trophy size={48} style={{ color }} />}
          </div>
          <div className="hero-meta">
            <span className="hero-eyebrow" style={{ color }}>{t.houseMembers}</span>
            <h1 className="hero-name">{displayName}</h1>
            <div className="hero-stats">
              <span className="hero-chip" style={{ borderColor: alpha(color, 0.25), color }}>
                <Users size={16} /> {members.length} {t.membersCount}
              </span>
              <span className="hero-chip" style={{ borderColor: alpha(color, 0.25), color }}>
                <Trophy size={16} /> {house.points} {t.points}
              </span>
            </div>
          </div>
        </header>

        {/* Join LINE group — sits right under the house banner */}
        <div className="join-line-wrap">
          <a
            href={LINE_GROUP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="join-line-btn"
          >
            <MessageCircle size={24} />
            {t.joinLineGroup}
          </a>
        </div>

        {/* Podium — top 3 members */}
        {podium.length > 0 && (
          <section className="podium-section">
            <div className="podium-container">
              {podiumOrder.map((m, i) => {
                if (!m) return null;
                const isMe = m.id === myId;
                return (
                  <div
                    key={m.id}
                    className={`podium-card ${placeClass[i]}`}
                    style={{ borderBottom: `8px solid ${color}` }}
                  >
                    {rankNum[i] === 1 && (
                      <div className="crown-floating"><Crown size={30} fill="var(--amber-400)" strokeWidth={1.5} /></div>
                    )}
                    <div className={`podium-rank-badge rank-${rankNum[i]}`}>{rankNum[i]}</div>
                    <h3 className="podium-name">
                      {m.name}
                      {m.nickname && <span className="podium-nick">({m.nickname})</span>}
                      {isMe && <span className="you-badge">{t.you || "YOU"}</span>}
                    </h3>
                    <div className="podium-points">
                      <span className="points-num" style={rankNum[i] === 1 ? { color } : undefined}>{m.points}</span>
                      <span className="points-unit">{t.points}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Remaining members */}
        {rest.length > 0 && (
          <section style={{ marginTop: 8 }}>
            <div className="member-list">
              {rest.map((m, idx) => {
                const rank = listStart + idx + 1;
                const isMe = m.id === myId;
                return (
                  <div className={`member-row${isMe ? " is-me" : ""}`} key={m.id}>
                    <div className="member-rank">{rank}</div>
                    <div className="member-info">
                      <span className="member-name">
                        {m.name} {m.nickname ? <span className="member-nick">({m.nickname})</span> : null}
                        {isMe && <span className="you-badge">{t.you || "YOU"}</span>}
                      </span>
                    </div>
                    <div className="member-progress">
                      <div className="member-bar" style={{ width: `${(m.points / maxPoints) * 100}%`, background: color }} />
                    </div>
                    <div className="member-points">
                      <span className="points-value">{m.points}</span>
                      <span className="points-label">{t.points}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="pagination">
            <button
              className="page-btn"
              onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
              disabled={currentPage === 1}
              aria-label="Previous page"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="page-indicator">
              {lang === "th"
                ? `หน้า ${currentPage} จาก ${totalPages}`
                : lang === "cn"
                  ? `第 ${currentPage} / ${totalPages} 页`
                  : lang === "mm"
                    ? `စာမျက်နှာ ${currentPage} / ${totalPages}`
                    : `Page ${currentPage} of ${totalPages}`}
            </span>
            <button
              className="page-btn"
              onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
              disabled={currentPage === totalPages}
              aria-label="Next page"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        )}

        {members.length === 0 && <div className="empty-state">{t.noMembersYet}</div>}
      </main>

      <style jsx>{`
        .back-link {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          color: var(--text-secondary);
          font-size: 14px;
          font-weight: 700;
          text-decoration: none;
          margin-bottom: 20px;
          transition: color 0.2s;
        }
        .back-link:hover { color: var(--accent-primary); }

        /* Hero */
        .house-hero {
          position: relative;
          display: flex;
          align-items: center;
          gap: 24px;
          border: 1px solid var(--border-subtle);
          border-radius: 28px;
          padding: 32px;
          overflow: hidden;
          margin-bottom: 40px;
        }
        .hero-glow {
          position: absolute;
          top: -60px;
          right: -40px;
          width: 200px;
          height: 200px;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.18;
          pointer-events: none;
        }
        .hero-avatar {
          width: 104px;
          height: 104px;
          border-radius: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          z-index: 1;
        }
        .hero-logo-img { width: 84%; height: 84%; object-fit: contain; }
        .hero-meta { z-index: 1; min-width: 0; }
        .hero-eyebrow {
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.12em;
        }
        .hero-name {
          font-size: clamp(28px, 5vw, 42px);
          font-weight: 900;
          letter-spacing: -0.04em;
          margin: 6px 0 14px;
          line-height: 1;
        }
        .hero-stats { display: flex; gap: 10px; flex-wrap: wrap; }
        .hero-chip {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 14px;
          font-weight: 800;
          padding: 8px 14px;
          border-radius: 999px;
          border: 1px solid;
          background: var(--bg-surface);
        }

        /* Podium (mirrors the leaderboard) */
        .podium-section { margin-bottom: 40px; }
        .podium-container {
          display: flex;
          align-items: flex-end;
          justify-content: center;
          gap: 20px;
          max-width: 760px;
          margin: 0 auto;
          padding: 28px 0;
        }
        .podium-card {
          flex: 1;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: 26px;
          padding: 22px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 14px;
          position: relative;
          box-shadow: 0 10px 30px rgb(var(--shadow-rgb) / 0.02);
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .podium-card:hover { transform: translateY(-4px); box-shadow: 0 20px 40px rgb(var(--shadow-rgb) / 0.06); }
        .first-place { min-height: 210px; z-index: 2; }
        .second-place, .third-place { min-height: 180px; }
        .crown-floating {
          position: absolute;
          top: -22px;
          left: 50%;
          transform: translateX(-50%);
          animation: float 3s ease-in-out infinite;
        }
        @keyframes float { 0%,100% { transform: translateX(-50%) translateY(0); } 50% { transform: translateX(-50%) translateY(-6px); } }
        .podium-rank-badge {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          font-size: 14px;
          color: var(--text-on-color);
        }
        .rank-1 { background: linear-gradient(135deg, var(--amber-400), var(--amber-500)); }
        .rank-2 { background: linear-gradient(135deg, var(--slate-300), var(--slate-400)); }
        .rank-3 { background: linear-gradient(135deg, var(--medal-bronze-light), var(--amber-700)); }
        .podium-name {
          font-size: 15px;
          font-weight: 800;
          text-align: center;
          margin: 0;
          line-height: 1.35;
        }
        .podium-nick { display: block; font-size: 12px; color: var(--text-muted); font-weight: 600; }
        .podium-points { display: flex; flex-direction: column; align-items: center; }
        .points-num { font-size: 26px; font-weight: 900; line-height: 1; }
        .first-place .points-num { font-size: 30px; }
        .points-unit { font-size: 11px; color: var(--text-muted); font-weight: 700; margin-top: 2px; }

        /* List */
        .member-list { display: flex; flex-direction: column; gap: 10px; }
        .member-row {
          display: flex;
          align-items: center;
          gap: 16px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: 18px;
          padding: 14px 20px;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .member-row:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgb(var(--shadow-rgb) / 0.04); }
        .member-row.is-me {
          border-color: var(--accent-primary);
          background: rgb(var(--accent-rgb) / 0.05);
          box-shadow: 0 0 0 1px var(--accent-primary), 0 8px 24px rgb(var(--accent-rgb) / 0.08);
        }
        .member-rank {
          width: 28px;
          text-align: center;
          font-weight: 900;
          font-size: 15px;
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .member-info { flex: 2; min-width: 0; }
        .member-name { font-size: 15px; font-weight: 700; color: var(--text-primary); }
        .member-nick { color: var(--text-muted); font-weight: 600; }
        .member-progress {
          flex: 3;
          height: 8px;
          background: var(--bg-elevated);
          border-radius: 999px;
          overflow: hidden;
        }
        .member-bar { height: 100%; border-radius: 999px; transition: width 0.4s ease; }
        .member-points { text-align: right; flex-shrink: 0; min-width: 64px; }
        .points-value { display: block; font-size: 16px; font-weight: 900; color: var(--text-primary); }
        .points-label { font-size: 11px; color: var(--text-muted); font-weight: 600; }
        .you-badge {
          display: inline-block;
          margin-left: 8px;
          padding: 2px 8px;
          border-radius: 999px;
          background: var(--accent-primary);
          color: var(--text-on-color);
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.08em;
          vertical-align: middle;
        }
        .empty-state {
          text-align: center;
          padding: 48px 20px;
          color: var(--text-muted);
          font-size: 15px;
          font-weight: 600;
        }

        /* Pagination */
        .pagination {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          margin-top: 28px;
        }
        .page-btn {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          border: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          color: var(--text-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }
        .page-btn:hover:not(:disabled) { border-color: var(--accent-primary); }
        .page-btn:disabled { opacity: 0.5; cursor: not-allowed; color: var(--text-muted); }
        .page-indicator {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
        }

        /* Join LINE group button — large CTA directly under the house banner */
        .join-line-wrap {
          display: flex;
          justify-content: center;
          margin: -16px 0 36px;
        }
        .join-line-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          width: 100%;
          max-width: 480px;
          padding: 20px 36px;
          border-radius: 20px;
          background: var(--brand-line);
          color: var(--text-on-color);
          font-size: 18px;
          font-weight: 900;
          text-decoration: none;
          box-shadow: 0 12px 32px rgb(var(--brand-line-rgb) / 0.32);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .join-line-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 18px 40px rgb(var(--brand-line-rgb) / 0.4);
        }

        @media (max-width: 640px) {
          .house-hero { flex-direction: column; text-align: center; padding: 28px 20px; gap: 16px; }
          .hero-stats { justify-content: center; }
          .hero-avatar { width: 88px; height: 88px; }
          .podium-container { gap: 10px; padding: 24px 0 8px; }
          .podium-card { padding: 16px 10px; border-radius: 20px; }
          .first-place { min-height: 210px; }
          .second-place, .third-place { min-height: 180px; }
          .podium-name { font-size: 13px; }
          .points-num { font-size: 22px; }
          .first-place .points-num { font-size: 26px; }
          .member-progress { display: none; }
        }
      `}</style>
    </div>
  );
}

const noticeStyles = `
  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-secondary);
    font-size: 14px;
    font-weight: 700;
    text-decoration: none;
    margin-bottom: 24px;
    transition: color 0.2s;
  }
  .back-link:hover { color: var(--accent-primary); }
  .notice-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    text-align: center;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 24px;
    padding: 56px 24px;
    color: var(--text-secondary);
    font-size: 16px;
    font-weight: 600;
  }
`;
