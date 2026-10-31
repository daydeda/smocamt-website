"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Calendar, Plus, RefreshCcw, Trophy, Users } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { usePolling } from "@/lib/hooks/usePolling";
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel, StatCard, useToast } from "@/components/admin/ui";
import { ActivityLine, type DashboardActivity } from "./_components/ActivityLine";
import { AwardPointsModal } from "./_components/AwardPointsModal";
import { translateHouseName } from "./_lib/activity-reason";

type DashboardStats = {
  totalUsers: number;
  totalEvents: number;
  userGrowthPct: number;
  recentActivity: DashboardActivity[];
  houses: { id: string; name: string; points: number; members: number; faculty?: string; colorGroup?: string }[];
};

const HOUSE_GRADIENT: Record<string, string> = {
  red: "linear-gradient(135deg, var(--red-500), var(--red-700))", // Red (Mom)
  green: "linear-gradient(135deg, var(--slate-400), var(--slate-500))", // White → silver/pewter (To)
  yellow: "linear-gradient(135deg, var(--blue-500), var(--blue-700))", // Blue (Luang)
  blue: "linear-gradient(135deg, var(--green-500), var(--green-700))", // Green (Makon)
};

const MEDAL = ["🥇", "🥈", "🥉"];

const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), s);

export default function AdminDashboardOverview() {
  const { t } = useLanguage();
  const toast = useToast();
  const [stats, setStats] = useState<DashboardStats | { error: string } | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const houseLabel = (h: { id: string; name: string; faculty?: string; colorGroup?: string }) =>
    translateHouseName(t, h.colorGroup || h.id, h.name);

  // Returns the fetch chain so usePolling can await it and never stack requests.
  const fetchStats = (signal?: AbortSignal) =>
    fetch("/api/admin/dashboard", { signal })
      .then((r) => r.json())
      .then((d) => {
        setStats(d);
        if (!d || !d.error) setUpdatedAt(new Date());
      });

  // Poll the dashboard endpoint for near-real-time updates. The endpoint already
  // returns the full fresh state (counts, houses, recent activity), so a refetch
  // replaces the previous incremental SSE logic. 10s is responsive for the handful
  // of admins watching this screen (who leave it open the whole event, so it is a
  // constant drain), and polling pauses when the tab is hidden.
  // A failed poll is rethrown so usePolling still backs off; we only record it so
  // the first load can show a retry instead of spinning forever.
  usePolling(async (signal) => {
    try {
      await fetchStats(signal);
      setLoadFailed(false);
    } catch (e) {
      setLoadFailed(true);
      throw e;
    }
  }, 10000);

  // Nudge the event-winner award check on its own slow cadence (every 60s), as a
  // separate fire-and-forget request. Decoupled from the data poll so it adds far
  // less load on the DB pooler; awarding the winner bonus a minute after an event
  // ends is invisible to everyone, so this is purely a background nudge. Errors are
  // ignored on purpose.
  usePolling((signal) => fetch("/api/admin/award-check", { signal }).catch(() => {}), 60000);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetchStats();
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      toast.error(t.adminOvRefreshFailed, t.adminUiErrorBody);
    } finally {
      setRefreshing(false);
    }
  };

  const [selectedHouse, setSelectedHouse] = useState<{ id: string; label: string; points: number } | null>(null);

  const sortedHouses = stats && "houses" in stats && Array.isArray(stats.houses)
    ? [...stats.houses].sort((a, b) => b.points - a.points)
    : [];

  const updatedTime = updatedAt
    ? updatedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" })
    : null;

  return (
    <div className="animate-fade-in-up">
      <PageHeader
        title={t.dashboard}
        description={t.adminOvDashDesc}
        actions={
          <>
            {updatedTime && (
              <span style={{ fontSize: 13, color: "var(--text-muted)" }} aria-live="polite">
                {fill(t.adminUiUpdatedAt, { time: updatedTime })}
              </span>
            )}
            <button
              id="refresh-stats-btn"
              type="button"
              className="btn btn-ghost"
              style={{ gap: 8 }}
              disabled={refreshing}
              onClick={refresh}
            >
              {refreshing ? <div className="spinner" aria-hidden="true" /> : <RefreshCcw size={16} aria-hidden="true" />}
              {refreshing ? t.adminOvRefreshing : t.refresh}
            </button>
          </>
        }
      />

      {!stats ? (
        loadFailed ? (
          <ErrorState title={t.adminOvLoadFailedTitle} onRetry={refresh} />
        ) : (
          <LoadingState label={t.adminOvLoading} />
        )
      ) : "error" in stats ? (
        <ErrorState title={t.adminOvLoadFailedTitle} message={stats.error} onRetry={refresh} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Totals */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StatCard
              label={t.adminOvStatStudents}
              value={stats.totalUsers.toLocaleString("en-US")}
              hint={t.adminOvStatStudentsHint}
              icon={<Users size={18} />}
              tone="info"
              trend={
                stats.userGrowthPct > 0
                  ? { direction: "up", text: fill(t.adminOvStatGrowthText, { pct: stats.userGrowthPct }), title: t.adminOvStatGrowthTitle }
                  : undefined
              }
            />
            <StatCard
              label={t.adminOvStatEvents}
              value={stats.totalEvents.toLocaleString("en-US")}
              hint={t.adminOvStatEventsHint}
              icon={<Calendar size={18} />}
              tone="accent"
            />
          </div>

          {/* House leaderboard */}
          <Panel title={t.adminOvLeaderboard} description={t.adminOvLeaderboardDesc} icon={<Trophy size={18} />}>
            {sortedHouses.length === 0 ? (
              <EmptyState compact title={t.adminOvNoHouses} description={t.adminOvNoHousesDesc} />
            ) : (
              <ol className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {sortedHouses.map((house, idx) => {
                  const gradient = HOUSE_GRADIENT[house.colorGroup || house.id] || "var(--accent-primary)";
                  const label = houseLabel(house);
                  const avg = Math.round((house.points / (house.members || 1)) * 10) / 10;
                  return (
                    <li
                      key={house.id}
                      style={{
                        overflow: "hidden",
                        background: "var(--bg-surface)",
                        border: idx === 0 ? "1px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                        borderRadius: "var(--radius-lg)",
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <div aria-hidden="true" style={{ height: 6, background: gradient }} />
                      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                        <p style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>
                          <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>{MEDAL[idx] ?? "🏅"}</span>
                          {fill(t.adminOvRankN, { n: idx + 1 })}
                        </p>
                        <h3 style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.4 }}>{label}</h3>
                        <p style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                          <span style={{ fontSize: 36, fontWeight: 800, lineHeight: 1.2, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: "var(--text-primary)" }}>
                            {house.points.toLocaleString("en-US")}
                          </span>
                          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-muted)" }}>{t.adminOvPts}</span>
                        </p>
                        <div aria-hidden="true" style={{ height: 4, background: "rgb(var(--ink-rgb) / 0.06)", borderRadius: 2, overflow: "hidden" }}>
                          <div
                            style={{
                              width: `${(house.points / (sortedHouses[0].points || 1)) * 100}%`,
                              height: "100%",
                              background: gradient,
                              transition: "width 1s ease-out",
                            }}
                          />
                        </div>
                        <p style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--text-muted)" }}>
                          <span>{fill(t.adminOvMembersCount, { n: house.members.toLocaleString("en-US") })}</span>
                          <span>{fill(t.adminOvAvgPerMember, { n: avg })}</span>
                        </p>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ width: "100%", minHeight: 44, gap: 8, marginTop: "auto" }}
                          aria-label={fill(t.adminOvAwardAria, { house: label })}
                          onClick={() => setSelectedHouse({ id: house.id, label, points: house.points })}
                        >
                          <Plus size={16} aria-hidden="true" />
                          {t.adminOvAwardPoints}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>

          <div className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-6" style={{ alignItems: "start" }}>
            {/* Recent activity */}
            <Panel
              title={t.recentActivity}
              actions={
                <Link href="/admin/activity" className="btn btn-ghost btn-sm" style={{ gap: 4 }}>
                  {t.viewAll}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              }
            >
              {!stats.recentActivity || stats.recentActivity.length === 0 ? (
                <EmptyState compact title={t.noActivityRecorded} description={t.adminOvActivityEmptyDesc} />
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                  {stats.recentActivity.map((a, i) => (
                    <ActivityLine key={i} a={a} />
                  ))}
                </ul>
              )}
            </Panel>

            {/* Quick links */}
            <Panel title={t.adminOvQuickLinks}>
              <div className="grid grid-cols-1 gap-3">
                <Link href="/admin/events" className="adm-stat adm-stat-link" style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 16 }}>
                  <span className="adm-stat-icon adm-tone-accent" aria-hidden="true"><Calendar size={18} /></span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 15 }}>{t.adminOvLinkEvents}</span>
                    <span className="adm-stat-hint" style={{ display: "block" }}>{t.adminOvLinkEventsDesc}</span>
                  </span>
                </Link>
                <Link href="/admin/students" className="adm-stat adm-stat-link" style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 16 }}>
                  <span className="adm-stat-icon adm-tone-info" aria-hidden="true"><Users size={18} /></span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 15 }}>{t.adminOvLinkStudents}</span>
                    <span className="adm-stat-hint" style={{ display: "block" }}>{t.adminOvLinkStudentsDesc}</span>
                  </span>
                </Link>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {selectedHouse && (
        <AwardPointsModal
          key={selectedHouse.id}
          house={selectedHouse}
          onClose={() => setSelectedHouse(null)}
          onDone={() => {
            // Full re-fetch so the leaderboard and activity log both update.
            fetchStats().catch(() => {});
          }}
        />
      )}
    </div>
  );
}
