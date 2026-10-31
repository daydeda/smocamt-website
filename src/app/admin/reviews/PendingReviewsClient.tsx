"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Calendar, ChevronRight, ClipboardList } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel, StatusBadge } from "@/components/admin/ui";

type PendingForm = {
  id: string;
  eventId: string;
  eventTitle: string | null;
  title: string;
  formType: string;
  updatedAt: string;
};

type PendingEvent = {
  id: string;
  title: string;
  startTime: string;
  ownerClubIds: string[] | null;
  ownerMajors: string[] | null;
  updatedAt: string;
};

/** A row that deep-links to the thing needing review. */
function ReviewRow({ href, title, subtitle, pendingLabel }: { href: string; title: string; subtitle: string; pendingLabel: string }) {
  return (
    <li>
      <Link
        href={href}
        className="adm-stat adm-stat-link"
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 16, minHeight: 64 }}
      >
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontWeight: 700, fontSize: 14, overflowWrap: "anywhere" }}>{title}</span>
          <span style={{ display: "block", fontSize: 13, color: "var(--text-muted)", marginTop: 2, overflowWrap: "anywhere" }}>{subtitle}</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <StatusBadge tone="warning">{pendingLabel}</StatusBadge>
          <ChevronRight size={18} aria-hidden="true" style={{ color: "var(--text-muted)" }} />
        </span>
      </Link>
    </li>
  );
}

// Aggregate dashboard so staff don't have to open each event individually and
// notice a review banner — see GET /api/admin/reviews. Each row deep-links
// straight to the thing that needs reviewing: a form row opens the Feedback
// Form modal directly (?openForm=<eventId>, same shortcut club/major
// presidents use, see admin/events/page.tsx), an event row opens the plain
// event editor (?edit=<eventId>).
export function PendingReviewsClient() {
  const { t } = useLanguage();
  const [pendingForms, setPendingForms] = useState<PendingForm[]>([]);
  const [pendingEvents, setPendingEvents] = useState<PendingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    fetch("/api/admin/reviews")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) {
          setFailed(true);
          return;
        }
        setPendingForms(Array.isArray(d.forms) ? d.forms : []);
        setPendingEvents(Array.isArray(d.events) ? d.events : []);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Deferred so the loading flag flips outside the synchronous effect body.
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const count = (n: number) => <StatusBadge tone={n > 0 ? "warning" : "neutral"} icon={false}>{n}</StatusBadge>;

  return (
    <div className="pb-20">
      <PageHeader title={t.adminOvRevTitle} description={t.adminOvRevDesc} />

      {loading ? (
        <LoadingState variant="skeleton" rows={4} />
      ) : failed ? (
        <ErrorState onRetry={load} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <Panel title={t.adminOvRevFormsTitle} icon={<ClipboardList size={18} />} actions={count(pendingForms.length)}>
            {pendingForms.length === 0 ? (
              <EmptyState compact title={t.adminOvRevFormsEmpty} description={t.adminOvRevEmptyDesc} />
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {pendingForms.map((f) => (
                  <ReviewRow
                    key={f.id}
                    href={`/admin/events?openForm=${f.eventId}`}
                    title={f.title}
                    subtitle={f.eventTitle ?? ""}
                    pendingLabel={t.adminProposalsFilterPending}
                  />
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={t.adminOvRevEventsTitle} icon={<Calendar size={18} />} actions={count(pendingEvents.length)}>
            {pendingEvents.length === 0 ? (
              <EmptyState compact title={t.adminOvRevEventsEmpty} description={t.adminOvRevEmptyDesc} />
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {pendingEvents.map((e) => (
                  <ReviewRow
                    key={e.id}
                    href={`/admin/events?edit=${e.id}`}
                    title={e.title}
                    subtitle={new Date(e.startTime).toLocaleDateString()}
                    pendingLabel={t.adminProposalsFilterPending}
                  />
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
