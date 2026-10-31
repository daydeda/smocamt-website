"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { EmptyState, ErrorState, InlineAlert, LoadingState, PageHeader, Panel, StatusBadge, TableScroll } from "@/components/admin/ui";

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
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    fetch(`/api/admin/audit-logs?page=${page}&pageSize=${PAGE_SIZE}`)
      .then((r) => r.json())
      .then((d) => {
        if (d && Array.isArray(d.logs)) {
          setLogs(d.logs);
          setTotal(typeof d.total === "number" ? d.total : d.logs.length);
        } else {
          setFailed(true);
        }
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => {
    // Deferred so the loading flag flips outside the synchronous effect body.
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const locale = lang === "th" ? "th-TH" : lang === "cn" ? "zh-CN" : "en-GB";

  const roleLabel = (role: string) =>
    role === "super_admin" ? t.roleSuperAdmin
      : role === "admin" ? t.roleAdmin
      : role === "registration" ? t.roleRegistration
      : role === "organizer" ? t.roleOrganizer
      : (role === "staff" || role === "professor" || role === "officer") ? t.roleStaff
      : role === "smo" ? t.roleSMO
      : role === "anusmo" ? t.roleANUSMO
      : role === "club_president" ? t.roleClubPresident
      : role === "major_president" ? t.roleMajorPresident
      : t.roleStudent;

  return (
    <div className="pb-20">
      <PageHeader
        title={t.auditTrailsTitle}
        description={t.adminOvAuditDesc}
        meta={<StatusBadge tone="neutral" icon={false}>{t.immutableLogsBadge}</StatusBadge>}
      />

      <div style={{ marginBottom: 20 }}>
        <InlineAlert tone="info">{t.auditAlertText}</InlineAlert>
      </div>

      {loading ? (
        <LoadingState variant="skeleton" rows={8} />
      ) : failed ? (
        <ErrorState onRetry={load} />
      ) : logs.length === 0 ? (
        <EmptyState title={t.noLogsRecorded} description={t.adminOvAuditEmptyDesc} />
      ) : (
        <Panel padded={false}>
          <TableScroll label={t.auditTrailsTitle}>
            <table className="data-table" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ whiteSpace: "nowrap" }}>{t.thTimestamp}</th>
                  <th style={{ whiteSpace: "nowrap" }}>{t.thActor}</th>
                  <th style={{ minWidth: 220 }}>{t.thAction}</th>
                  <th style={{ minWidth: 240 }}>{t.thTarget}</th>
                  <th style={{ whiteSpace: "nowrap" }}>{t.thIpAddress}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const date = new Date(log.timestamp);
                  return (
                    <tr key={log.id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <p style={{ fontSize: 14, color: "var(--text-primary)" }}>
                          {date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" })}
                        </p>
                        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Bangkok" })}
                        </p>
                      </td>
                      <td>
                        <p style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>{log.actor?.name ?? "System"}</p>
                        {log.actor?.role && (
                          <div style={{ marginTop: 4 }}>
                            <StatusBadge tone="info" icon={false}>{roleLabel(log.actor.role)}</StatusBadge>
                          </div>
                        )}
                      </td>
                      <td>
                        <StatusBadge tone="neutral" icon={false}>{log.action}</StatusBadge>
                      </td>
                      <td style={{ maxWidth: 420, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                        <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>{log.target?.name ?? "—"}</span>
                        {log.target?.studentId && (
                          <code style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 6 }}>({log.target.studentId})</code>
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <code style={{ fontSize: 12, color: "var(--text-muted)" }}>{log.ipAddress ?? "—"}</code>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}

      {!loading && !failed && total > PAGE_SIZE && (
        <nav
          aria-label={t.adminOvPagination}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginTop: 20 }}
        >
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t.adminAppealsShowingRange
              .replace("{from}", String((currentPage - 1) * PAGE_SIZE + 1))
              .replace("{to}", String(Math.min(currentPage * PAGE_SIZE, total)))
              .replace("{total}", String(total))}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" className="btn btn-ghost" style={{ gap: 4 }} disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft size={16} aria-hidden="true" />
              {t.adminAppealsPrevious}
            </button>
            <span style={{ fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
              {t.adminAppealsPageOf.replace("{page}", String(currentPage)).replace("{total}", String(totalPages))}
            </span>
            <button type="button" className="btn btn-ghost" style={{ gap: 4 }} disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              {t.adminAppealsNext}
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
