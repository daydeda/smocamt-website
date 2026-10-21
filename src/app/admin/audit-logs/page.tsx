"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageContext";

type AuditLog = {
  id: string;
  timestamp: string;
  action: string;
  ipAddress?: string;
  actor?: { id: string; name: string; role: string } | null;
  target?: { id: string; name: string; studentId?: string } | null;
};

const PAGE_SIZE = 30;

export default function AdminAuditLogsPage() {
  const { t, lang } = useLanguage();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    // Deferred so the loading flag flips outside the synchronous effect body.
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/admin/audit-logs?page=${page}&pageSize=${PAGE_SIZE}`)
        .then((r) => r.json())
        .then((d) => {
          if (d && Array.isArray(d.logs)) {
            setLogs(d.logs);
            setTotal(typeof d.total === "number" ? d.total : d.logs.length);
          }
        })
        .finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(timer);
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  return (
    <div className="pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4" style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: "clamp(28px,5vw,42px)", fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.3 }}>{t.auditTrailsTitle}</h1>
        <div className="flex gap-3 items-center flex-wrap">
          <span className="badge badge-red">{t.immutableLogsBadge}</span>
        </div>
      </div>

      <div className="alert alert-info" style={{ marginBottom: 24, fontSize: 13 }}>
        <span>ℹ️</span>
        <span>
          {t.auditAlertText}
        </span>
      </div>

      {/* Table */}
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
        }}
      >
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
            <div className="spinner" style={{ width: 28, height: 28 }} />
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ minWidth: 960 }}>
              <thead>
                <tr>
                  <th style={{ whiteSpace: "nowrap" }}>{t.thTimestamp}</th>
                  <th style={{ whiteSpace: "nowrap" }}>{t.thActor}</th>
                  <th style={{ minWidth: 260 }}>{t.thAction}</th>
                  <th style={{ minWidth: 280, whiteSpace: "nowrap" }}>{t.thTarget}</th>
                  <th style={{ whiteSpace: "nowrap" }}>{t.thIpAddress}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {(() => {
                        const date = new Date(log.timestamp);
                        const locale = lang === "th" ? "th-TH" : lang === "cn" ? "zh-CN" : "en-GB";
                        return (
                          <>
                            <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                              {date.toLocaleDateString(locale, {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                                timeZone: "Asia/Bangkok",
                              })}
                            </p>
                            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                              {date.toLocaleTimeString(locale, {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                                hour12: false,
                                timeZone: "Asia/Bangkok",
                              })}
                            </p>
                          </>
                        );
                      })()}
                    </td>
                    <td>
                      <p style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>
                        {log.actor?.name ?? "System"}
                      </p>
                      {log.actor?.role && (
                        <span className="badge badge-purple" style={{ fontSize: 10, marginTop: 4 }}>
                          {log.actor.role === "super_admin" ? t.roleSuperAdmin : log.actor.role === "admin" ? t.roleAdmin : log.actor.role === "registration" ? t.roleRegistration : log.actor.role === "organizer" ? t.roleOrganizer : (log.actor.role === "staff" || log.actor.role === "professor" || log.actor.role === "officer") ? t.roleStaff : log.actor.role === "smo" ? t.roleSMO : log.actor.role === "anusmo" ? t.roleANUSMO : log.actor.role === "club_president" ? t.roleClubPresident : log.actor.role === "major_president" ? t.roleMajorPresident : t.roleStudent}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-red" style={{ fontSize: 11 }}>
                        {log.action}
                      </span>
                    </td>
                    <td style={{ minWidth: 280, maxWidth: 420, whiteSpace: "normal", wordBreak: "break-word" }}>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>
                        {log.target?.name ?? "—"}
                      </span>
                      {log.target?.studentId && (
                        <code style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 6 }}>
                          ({log.target.studentId})
                        </code>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <code style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {log.ipAddress ?? "—"}
                      </code>
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                      {t.noLogsRecorded}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div
          className="flex items-center justify-between gap-4 flex-wrap"
          style={{ marginTop: 20 }}
        >
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, total)} / {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="btn btn-ghost"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ←
            </button>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {currentPage} / {totalPages}
            </span>
            <button
              className="btn btn-ghost"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}