"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, Circle, Loader2, Pencil, Printer, QrCode, Search, Tag } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { formatTagLabel, MAX_TAGS_PER_BATCH, normalizeSeries } from "@/lib/property-tags/property-tag";
import {
  PageHeader,
  Panel,
  Toolbar,
  TableScroll,
  Tabs,
  TabPanel,
  Modal,
  Field,
  StatusBadge,
  LoadingState,
  EmptyState,
  ErrorState,
  useToast,
  type TabItem,
} from "@/components/admin/ui";
import PropertyTagPanel from "../PropertyTagPanel";

// /admin/property-tags/[id] — one group: generate tags, see who owns which,
// open the print sheet, and manage any single tag without scanning it.

interface Group {
  id: string;
  name: string;
  description: string | null;
  status: "open" | "archived";
}

interface TagRow {
  id: string;
  code: string;
  series: string;
  serial: number;
  label: string;
  assignedAt: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerStudentId: string | null;
  ownerMajor: string | null;
}

type Filter = "all" | "assigned" | "empty";

const TZ = "Asia/Bangkok";

export default function PropertyTagGroupClient({ groupId }: { groupId: string }) {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const [group, setGroup] = useState<Group | null>(null);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [seriesMax, setSeriesMax] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [series, setSeries] = useState("STU");
  const [count, setCount] = useState("50");
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [managing, setManaging] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);

  const load = useCallback(async () => {
    try {
      const [groupRes, listRes] = await Promise.all([
        fetch(`/api/admin/property-tags/${groupId}`),
        fetch("/api/admin/property-tags"),
      ]);
      if (!groupRes.ok) throw new Error();
      const data = await groupRes.json();
      setGroup(data.group);
      setTags(data.tags ?? []);
      if (listRes.ok) {
        const list = await listRes.json();
        setSeriesMax(Object.fromEntries((list.series ?? []).map((s: { series: string; maxSerial: number }) => [s.series, s.maxSerial])));
      }
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const normalizedSeries = normalizeSeries(series);
  const countNum = Number(count);
  const countValid = Number.isInteger(countNum) && countNum >= 1 && countNum <= MAX_TAGS_PER_BATCH;

  async function generate() {
    if (!normalizedSeries || !countValid) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/admin/property-tags/${groupId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ series: normalizedSeries, count: countNum }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success(t.adminPtGenerated.replace("{first}", data.first).replace("{last}", data.last));
      await load();
    } catch {
      toast.error(t.adminPtError);
    } finally {
      setGenerating(false);
    }
  }

  async function patchGroup(patch: Partial<Pick<Group, "name" | "description" | "status">>) {
    setSavingGroup(true);
    try {
      const res = await fetch(`/api/admin/property-tags/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
      setEditing(false);
      toast.success(t.adminPtUiGroupSaved);
      await load();
    } catch {
      toast.error(t.adminPtError);
    } finally {
      setSavingGroup(false);
    }
  }

  // Archiving only hides the group from the default list and is undone by
  // Restore, so it needs a result toast but no confirmation.
  async function toggleArchive() {
    if (!group) return;
    const next = group.status === "open" ? "archived" : "open";
    await patchGroup({ status: next });
  }

  const seriesInGroup = useMemo(() => [...new Set(tags.map((tg) => tg.series))], [tags]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tags.filter((tg) => {
      if (filter === "assigned" && !tg.ownerId) return false;
      if (filter === "empty" && tg.ownerId) return false;
      if (!q) return true;
      return [tg.label, tg.code, tg.ownerName, tg.ownerStudentId].some((v) => v?.toLowerCase().includes(q));
    });
  }, [tags, filter, query]);

  // Pagination: a group can hold a thousand+ tags, so only one page is in the DOM.
  // `page` is clamped on read, so a shrinking filter can never strand the view
  // past the last page.
  const lastPage = Math.max(0, Math.ceil(visible.length / pageSize) - 1);
  const safePage = Math.min(page, lastPage);
  const pageStart = safePage * pageSize;
  const pageRows = visible.slice(pageStart, pageStart + pageSize);

  const assignedCount = tags.filter((tg) => tg.ownerId).length;
  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString(lang === "th" ? "th-TH" : "en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });

  if (loading) {
    return <LoadingState variant="skeleton" rows={4} label={t.adminPtLoading} />;
  }

  if (error || !group) {
    return <ErrorState message={t.adminPtLoadError} onRetry={() => { setLoading(true); void load(); }} />;
  }

  const filterTabs: TabItem<Filter>[] = [
    { id: "all", label: t.adminPtFilterAll, count: tags.length },
    { id: "assigned", label: t.adminPtFilterAssigned, count: assignedCount },
    { id: "empty", label: t.adminPtFilterEmpty, count: tags.length - assignedCount },
  ];

  return (
    <div className="pb-20" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader
        back={{ href: "/admin/property-tags", label: t.adminPtBackToGroups }}
        title={group.name}
        meta={group.status === "archived" ? <StatusBadge tone="warning" icon={false}>{t.adminPtArchived}</StatusBadge> : undefined}
        description={
          <>
            {group.description && <span style={{ display: "block", overflowWrap: "anywhere" }}>{group.description}</span>}
            <span style={{ display: "block", fontWeight: 600, color: "var(--text-muted)" }}>
              {t.adminPtAssignedCount.replace("{assigned}", String(assignedCount)).replace("{total}", String(tags.length))}
            </span>
          </>
        }
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setScanning(true)}>
              <QrCode size={18} aria-hidden="true" /> {t.adminPtScanAssign}
            </button>
            {tags.length === 0 ? (
              <button className="btn btn-primary" disabled>
                <Printer size={18} aria-hidden="true" /> {t.adminPtPrint}
              </button>
            ) : (
              <Link href={`/admin/property-tags/${groupId}/print`} className="btn btn-primary">
                <Printer size={18} aria-hidden="true" /> {t.adminPtPrint}
              </Link>
            )}
          </>
        }
      />

      {/* Rarely used, so kept out of the header's action row. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { setEditName(group.name); setEditDescription(group.description ?? ""); setEditing(true); }}
        >
          <Pencil size={15} aria-hidden="true" /> {t.adminPtEdit}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={savingGroup}
          onClick={() => void toggleArchive()}
        >
          {group.status === "open" ? <Archive size={15} aria-hidden="true" /> : <ArchiveRestore size={15} aria-hidden="true" />}
          {group.status === "open" ? t.adminPtArchive : t.adminPtUnarchive}
        </button>
      </div>

      {/* Generate */}
      <Panel title={t.adminPtGenerateTitle}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 140px", maxWidth: 200 }}>
            <Field label={t.adminPtSeries}>
              {(p) => (
                <>
                  <input
                    {...p}
                    className="input"
                    value={series}
                    maxLength={8}
                    onChange={(e) => setSeries(e.target.value.toUpperCase())}
                    list="pt-series-options"
                    autoCapitalize="characters"
                    style={{ fontFamily: "ui-monospace, monospace", letterSpacing: "0.06em" }}
                  />
                  <datalist id="pt-series-options">
                    {Object.keys(seriesMax).map((s) => <option key={s} value={s} />)}
                  </datalist>
                </>
              )}
            </Field>
            </div>
            <div style={{ flex: "1 1 120px", maxWidth: 160 }}>
            <Field label={t.adminPtCount}>
              {(p) => <input {...p} className="input" type="number" inputMode="numeric" min={1} max={MAX_TAGS_PER_BATCH} value={count} onChange={(e) => setCount(e.target.value)} />}
            </Field>
            </div>
            <button className="btn btn-primary" onClick={() => void generate()} disabled={generating || !normalizedSeries || !countValid}>
              {generating ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> {t.adminPtGenerating}</> : t.adminPtGenerateBtn}
            </button>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
            {normalizedSeries
              ? t.adminPtNextSerial.replace("{label}", formatTagLabel(normalizedSeries, (seriesMax[normalizedSeries] ?? 0) + 1))
              : t.adminPtInvalidSeries}
            {" · "}
            {countValid ? t.adminPtSeriesHint : t.adminPtInvalidCount.replace("{max}", String(MAX_TAGS_PER_BATCH))}
          </p>
        </div>
      </Panel>

      {/* Tag list */}
      {tags.length === 0 ? (
        <EmptyState icon={<Tag size={24} />} title={t.adminPtNoTags} />
      ) : (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Toolbar>
            <Tabs
              tabs={filterTabs}
              value={filter}
              onChange={(f) => { setFilter(f); setPage(0); }}
              ariaLabel={t.adminPtFilterAll}
              idBase="pt-filter"
            />
            <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 360 }}>
              <Search size={16} aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input className="input" type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder={t.adminPtSearchTags} aria-label={t.adminPtSearchTags} style={{ paddingLeft: 36 }} />
            </div>
            {seriesInGroup.length > 1 && (
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{seriesInGroup.join(" · ")}</span>
            )}
          </Toolbar>

          <TabPanel idBase="pt-filter" id={filter}>
            {visible.length === 0 ? (
              <EmptyState compact icon={<Search size={24} />} title={t.adminPtNoMatch} />
            ) : (
              <div className="stat-card" style={{ padding: 0, overflow: "hidden" }}>
                <TableScroll label={group.name}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t.adminPtColTag}</th>
                        <th>{t.adminPtColOwner}</th>
                        <th>{t.adminPtUiColStatus}</th>
                        <th>{t.adminPtColAssignedAt}</th>
                        <th><span className="sr-only">{t.adminPtManage}</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((tg) => (
                        <tr key={tg.id}>
                          <td>
                            <p style={{ fontSize: 14, fontWeight: 800, color: "var(--text-primary)" }}>{tg.label}</p>
                            <p style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "ui-monospace, monospace" }}>{tg.code}</p>
                          </td>
                          <td>
                            {tg.ownerId ? (
                              <>
                                <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{tg.ownerName}</p>
                                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                                  {[tg.ownerStudentId, tg.ownerMajor].filter(Boolean).join(" · ")}
                                </p>
                              </>
                            ) : (
                              <span style={{ color: "var(--text-muted)" }}>—</span>
                            )}
                          </td>
                          <td>
                            {tg.ownerId ? (
                              <StatusBadge tone="success">{t.adminPtFilterAssigned}</StatusBadge>
                            ) : (
                              <StatusBadge tone="neutral" icon={<Circle size={12} />}>{t.adminPtEmptyTag}</StatusBadge>
                            )}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>{tg.assignedAt ? fmtDate(tg.assignedAt) : "—"}</td>
                          <td style={{ textAlign: "right" }}>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setManaging(tg.code)}
                              aria-label={`${t.adminPtManage}: ${tg.label}`}
                            >
                              {t.adminPtManage}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              </div>
            )}
          </TabPanel>

          {visible.length > 0 && (
            <nav aria-label={t.adminPtPageSize} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                {t.adminPtShowing
                  .replace("{from}", String(pageStart + 1))
                  .replace("{to}", String(Math.min(pageStart + pageSize, visible.length)))
                  .replace("{total}", String(visible.length))}
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <label htmlFor="pt-page-size" style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.adminPtPageSize}</label>
                <select
                  id="pt-page-size"
                  className="input"
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
                  style={{ width: "auto", padding: "6px 36px 6px 10px" }}
                >
                  {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <button className="btn btn-ghost btn-sm" onClick={() => setPage(safePage - 1)} disabled={safePage === 0}>{t.adminPtPrev}</button>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{safePage + 1} / {lastPage + 1}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setPage(safePage + 1)} disabled={safePage >= lastPage}>{t.adminPtNext}</button>
              </div>
            </nav>
          )}
        </section>
      )}

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        dismissible={!savingGroup}
        size="md"
        icon={<Pencil size={20} />}
        title={t.adminPtEdit}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEditing(false)} disabled={savingGroup}>{t.adminPtCancel}</button>
            <button
              className="btn btn-primary"
              disabled={savingGroup || !editName.trim()}
              onClick={() => void patchGroup({ name: editName.trim(), description: editDescription.trim() || null })}
            >
              {savingGroup && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {t.adminPtSave}
            </button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Field label={t.adminPtGroupName} required>
            {(p) => <input {...p} className="input" value={editName} maxLength={200} onChange={(e) => setEditName(e.target.value)} />}
          </Field>
          <Field label={t.adminPtGroupDescription}>
            {(p) => <textarea {...p} className="input" rows={3} maxLength={2000} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />}
          </Field>
        </div>
      </Modal>

      {managing && (
        <PropertyTagPanel key={managing} initialCode={managing} onChanged={load} onClose={() => setManaging(null)} />
      )}
      {scanning && <PropertyTagPanel onChanged={load} onClose={() => setScanning(false)} />}
    </div>
  );
}
