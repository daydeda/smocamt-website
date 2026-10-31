"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Trophy, User } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel, StatusBadge, TableScroll, Toolbar } from "@/components/admin/ui";
import { translateActivityReason, translateHouseName } from "../dashboard/_lib/activity-reason";

type Activity =
  | { type: "checkin"; studentName: string; studentId: string; eventTitle: string; timestamp: string }
  | { type: "score"; houseId?: string; houseName: string; houseColor: string; delta: number; reason: string; timestamp: string };

const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), s);

export default function AdminActivityPage() {
  const { t, lang } = useLanguage();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    fetch("/api/admin/activity")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setActivities(d);
        else setFailed(true);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Deferred so the loading flag flips outside the synchronous effect body.
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const houseName = (a: { houseId?: string; houseName: string }) => translateHouseName(t, a.houseId || "", a.houseName);

  const q = search.toLowerCase();
  const filtered = activities.filter((a) => {
    if (a.type === "checkin") {
      return a.studentName.toLowerCase().includes(q) || a.eventTitle.toLowerCase().includes(q) || a.studentId.includes(q);
    }
    const houseTranslated = houseName(a);
    const reasonTranslated = translateActivityReason(a.reason, lang, t);
    return houseTranslated.toLowerCase().includes(q) || reasonTranslated.toLowerCase().includes(q) || a.reason.toLowerCase().includes(q);
  });

  const locale = lang === "th" ? "th-TH" : lang === "cn" ? "zh-CN" : "en-GB";

  return (
    <div className="animate-fade-in-up">
      <PageHeader
        back={{ href: "/admin/dashboard", label: t.dashboard }}
        title={t.fullActivityLogTitle}
        description={t.adminOvActivityDesc}
      />

      {loading ? (
        <LoadingState variant="skeleton" rows={6} />
      ) : failed ? (
        <ErrorState onRetry={load} />
      ) : activities.length === 0 ? (
        <EmptyState title={t.noActivityRecorded} description={t.adminOvActivityEmptyDesc} />
      ) : (
        <>
          <Toolbar>
            <div className="adm-search" style={{ position: "relative", maxWidth: 420 }}>
              <Search size={18} aria-hidden="true" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
              <input
                type="search"
                className="input"
                style={{ paddingLeft: 42 }}
                aria-label={t.searchActivityPlaceholder}
                placeholder={t.searchActivityPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }} aria-live="polite">
              {fill(t.adminOvShowingCount, { n: filtered.length, total: activities.length })}
            </span>
          </Toolbar>

          <Panel padded={false}>
            {filtered.length === 0 ? (
              <EmptyState
                compact
                title={fill(t.adminOvNoMatches, { q: search })}
                action={
                  <button type="button" className="btn btn-ghost" onClick={() => setSearch("")}>
                    {t.adminOvClearSearch}
                  </button>
                }
              />
            ) : (
              <TableScroll label={t.fullActivityLogTitle}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t.thTimestamp}</th>
                      <th>{t.thType}</th>
                      <th>{t.thDetails}</th>
                      <th className="num">{t.points}</th>
                      <th>{t.adminOvThContext}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((a, i) => (
                      <tr key={i}>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                            {new Date(a.timestamp).toLocaleTimeString(locale, { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false })}
                          </p>
                          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            {new Date(a.timestamp).toLocaleDateString(locale, { timeZone: "Asia/Bangkok", day: "2-digit", month: "short" })}
                          </p>
                        </td>
                        <td>
                          {a.type === "score" ? (
                            <StatusBadge tone="accent" icon={<Trophy size={12} />}>{t.badgePointAward}</StatusBadge>
                          ) : (
                            <StatusBadge tone="info" icon={<User size={12} />}>{t.badgeCheckin}</StatusBadge>
                          )}
                        </td>
                        <td>
                          {a.type === "checkin" ? (
                            <>
                              <p style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>{a.studentName}</p>
                              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{a.studentId}</p>
                            </>
                          ) : (
                            <>
                              <p style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>{houseName(a)}</p>
                              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.labelManualAdjustment}</p>
                            </>
                          )}
                        </td>
                        <td
                          className="num"
                          style={{
                            fontWeight: 800,
                            fontSize: 15,
                            whiteSpace: "nowrap",
                            color: a.type === "score" ? (a.delta > 0 ? "var(--emerald-600)" : a.delta === 0 ? "var(--text-muted)" : "var(--red-600)") : "var(--text-muted)",
                          }}
                        >
                          {a.type === "score" ? (a.delta > 0 ? `+${a.delta}` : a.delta) : "—"}
                        </td>
                        <td style={{ minWidth: 220, maxWidth: 420, whiteSpace: "normal", overflowWrap: "anywhere", fontSize: 14 }}>
                          {a.type === "checkin" ? (
                            <>
                              {t.attended} <b>{a.eventTitle}</b>
                            </>
                          ) : (
                            <span>&quot;{translateActivityReason(a.reason, lang, t)}&quot;</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
