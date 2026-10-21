"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, ArrowLeft, Loader2, Pencil, Printer, QrCode, Search, Tag } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import { formatTagLabel, MAX_TAGS_PER_BATCH, normalizeSeries } from "@/lib/property-tag";
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
  const [group, setGroup] = useState<Group | null>(null);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [seriesMax, setSeriesMax] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [series, setSeries] = useState("STU");
  const [count, setCount] = useState("50");
  const [generating, setGenerating] = useState(false);
  const [genMessage, setGenMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
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
    setGenMessage(null);
    try {
      const res = await fetch(`/api/admin/property-tags/${groupId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ series: normalizedSeries, count: countNum }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setGenMessage({ tone: "ok", text: t.adminPtGenerated.replace("{first}", data.first).replace("{last}", data.last) });
      await load();
    } catch {
      setGenMessage({ tone: "error", text: t.adminPtError });
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
      await load();
    } catch {
      setGenMessage({ tone: "error", text: t.adminPtError });
    } finally {
      setSavingGroup(false);
    }
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

  const assignedCount = tags.filter((tg) => tg.ownerId).length;
  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString(lang === "th" ? "th-TH" : "en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "48px 0", color: "var(--text-muted)", fontSize: 14 }}>
        <Loader2 size={18} className="animate-spin" /> {t.adminPtLoading}
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="stat-card" style={{ textAlign: "center", padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <p style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)" }}>{t.adminPtLoadError}</p>
        <button className="btn btn-ghost" onClick={() => { setLoading(true); void load(); }}>{t.adminPtRetry}</button>
      </div>
    );
  }

  return (
    <div className="pb-20" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Link href="/admin/property-tags" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 700, color: "var(--accent-primary)", alignSelf: "flex-start" }}>
        <ArrowLeft size={16} /> {t.adminPtBackToGroups}
      </Link>

      {/* Header */}
      {editing ? (
        <div className="stat-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, maxWidth: 560 }}>
          <div className="field">
            <label className="label" htmlFor="pt-edit-name">{t.adminPtGroupName}</label>
            <input id="pt-edit-name" className="input" value={editName} maxLength={200} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="pt-edit-desc">{t.adminPtGroupDescription}</label>
            <textarea id="pt-edit-desc" className="input" rows={2} maxLength={2000} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setEditing(false)} disabled={savingGroup}>{t.adminPtCancel}</button>
            <button
              className="btn btn-primary"
              disabled={savingGroup || !editName.trim()}
              onClick={() => void patchGroup({ name: editName.trim(), description: editDescription.trim() || null })}
            >
              {savingGroup ? <Loader2 size={16} className="animate-spin" /> : t.adminPtSave}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: "clamp(26px,4.5vw,38px)", fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.3, display: "flex", alignItems: "center", gap: 12, overflowWrap: "anywhere" }}>
              <Tag size={30} strokeWidth={2.5} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
              {group.name}
              {group.status === "archived" && <span className="badge badge-yellow">{t.adminPtArchived}</span>}
            </h1>
            {group.description && <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 6, overflowWrap: "anywhere" }}>{group.description}</p>}
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginTop: 6 }}>
              {t.adminPtAssignedCount.replace("{assigned}", String(assignedCount)).replace("{total}", String(tags.length))}
            </p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditName(group.name); setEditDescription(group.description ?? ""); setEditing(true); }}>
              <Pencil size={15} /> {t.adminPtEdit}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={savingGroup}
              onClick={() => void patchGroup({ status: group.status === "open" ? "archived" : "open" })}
            >
              {group.status === "open" ? <Archive size={15} /> : <ArchiveRestore size={15} />}
              {group.status === "open" ? t.adminPtArchive : t.adminPtUnarchive}
            </button>
          </div>
        </div>
      )}

      {/* Generate */}
      <section className="stat-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>{t.adminPtGenerateTitle}</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div className="field" style={{ flex: "1 1 140px", maxWidth: 200 }}>
            <label className="label" htmlFor="pt-series">{t.adminPtSeries}</label>
            <input
              id="pt-series"
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
          </div>
          <div className="field" style={{ flex: "1 1 120px", maxWidth: 160 }}>
            <label className="label" htmlFor="pt-count">{t.adminPtCount}</label>
            <input id="pt-count" className="input" type="number" inputMode="numeric" min={1} max={MAX_TAGS_PER_BATCH} value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={() => void generate()} disabled={generating || !normalizedSeries || !countValid}>
            {generating ? <><Loader2 size={16} className="animate-spin" /> {t.adminPtGenerating}</> : t.adminPtGenerateBtn}
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {normalizedSeries
            ? t.adminPtNextSerial.replace("{label}", formatTagLabel(normalizedSeries, (seriesMax[normalizedSeries] ?? 0) + 1))
            : t.adminPtInvalidSeries}
          {" · "}
          {countValid ? t.adminPtSeriesHint : t.adminPtInvalidCount.replace("{max}", String(MAX_TAGS_PER_BATCH))}
        </p>
        {genMessage && (
          <p role="status" style={{ fontSize: 13.5, fontWeight: 700, color: genMessage.tone === "ok" ? "var(--teal-600)" : "var(--red-600)" }}>{genMessage.text}</p>
        )}
      </section>

      {/* Actions */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Link href={`/admin/property-tags/${groupId}/print`} className="btn btn-primary" aria-disabled={tags.length === 0} style={tags.length === 0 ? { pointerEvents: "none", opacity: 0.5 } : undefined}>
          <Printer size={18} /> {t.adminPtPrint}
        </Link>
        <button className="btn btn-ghost" onClick={() => setScanning(true)}>
          <QrCode size={18} /> {t.adminPtScanAssign}
        </button>
      </div>

      {/* Tag list */}
      {tags.length === 0 ? (
        <p className="stat-card" style={{ padding: "32px 20px", textAlign: "center", fontSize: 14, color: "var(--text-muted)" }}>{t.adminPtNoTags}</p>
      ) : (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <div role="group" style={{ display: "flex", background: "var(--bg-elevated)", padding: 4, borderRadius: 12, border: "1px solid var(--border-subtle)" }}>
              {(["all", "assigned", "empty"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 9,
                    fontSize: 13,
                    fontWeight: 700,
                    border: "none",
                    cursor: "pointer",
                    background: filter === f ? "var(--bg-surface)" : "transparent",
                    color: filter === f ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  {f === "all" ? t.adminPtFilterAll : f === "assigned" ? t.adminPtFilterAssigned : t.adminPtFilterEmpty}
                </button>
              ))}
            </div>
            <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 360 }}>
              <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.adminPtSearchTags} aria-label={t.adminPtSearchTags} style={{ paddingLeft: 36 }} />
            </div>
            {seriesInGroup.length > 1 && (
              <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{seriesInGroup.join(" · ")}</span>
            )}
          </div>

          {visible.length === 0 ? (
            <p style={{ fontSize: 14, color: "var(--text-muted)", padding: "16px 0" }}>{t.adminPtNoMatch}</p>
          ) : (
            <ul className="stat-card" style={{ listStyle: "none", padding: 0, overflow: "hidden" }}>
              {visible.map((tg, i) => (
                <li
                  key={tg.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    borderTop: i === 0 ? "none" : "1px solid var(--border-subtle)",
                  }}
                >
                  <div style={{ width: 96, flexShrink: 0 }}>
                    <p style={{ fontSize: 14.5, fontWeight: 800, color: "var(--text-primary)" }}>{tg.label}</p>
                    <p style={{ fontSize: 11.5, color: "var(--text-muted)", fontFamily: "ui-monospace, monospace" }}>{tg.code}</p>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {tg.ownerId ? (
                      <>
                        <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{tg.ownerName}</p>
                        <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                          {[tg.ownerStudentId, tg.ownerMajor, tg.assignedAt ? fmtDate(tg.assignedAt) : null].filter(Boolean).join(" · ")}
                        </p>
                      </>
                    ) : (
                      <span className="badge badge-blue">{t.adminPtEmptyTag}</span>
                    )}
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => setManaging(tg.code)} style={{ flexShrink: 0 }}>
                    {t.adminPtManage}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {managing && (
        <PropertyTagPanel key={managing} initialCode={managing} onChanged={load} onClose={() => setManaging(null)} />
      )}
      {scanning && <PropertyTagPanel onChanged={load} onClose={() => setScanning(false)} />}
    </div>
  );
}
