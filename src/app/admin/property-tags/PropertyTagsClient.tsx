"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, PackageOpen, Plus, QrCode, Tag, Trash2 } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import PropertyTagPanel from "./PropertyTagPanel";

// /admin/property-tags — the list of tag groups ("Bag for Trekking", …).
// See docs/features/property-tags.md.

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  status: "open" | "archived";
  total: number;
  assigned: number;
}

export default function PropertyTagsClient() {
  const { t } = useLanguage();
  const router = useRouter();
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/property-tags");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setGroups(data.groups ?? []);
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

  async function create() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/property-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      });
      if (!res.ok) throw new Error();
      const { id } = await res.json();
      router.push(`/admin/property-tags/${id}`);
    } catch {
      setSaving(false);
      setError(true);
    }
  }

  async function deleteGroup(g: GroupRow) {
    setDeleting(true);
    setDeleteNotice(null);
    try {
      const res = await fetch(`/api/admin/property-tags/${g.id}`, { method: "DELETE" });
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        setDeleteNotice(t.adminPtDeleteBlocked.replace("{n}", String(data.assigned ?? g.assigned)));
        return;
      }
      if (!res.ok && res.status !== 404) throw new Error();
      setConfirmDelete(null);
      await load();
    } catch {
      setDeleteNotice(t.adminPtError);
    } finally {
      setDeleting(false);
    }
  }

  const visible = groups.filter((g) => showArchived || g.status === "open");
  const archivedCount = groups.filter((g) => g.status === "archived").length;

  return (
    <div className="pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: "clamp(28px,5vw,42px)", fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.3, display: "flex", alignItems: "center", gap: 12 }}>
            <Tag size={32} strokeWidth={2.5} style={{ color: "var(--accent-primary)" }} />
            {t.adminPropertyTags}
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 6 }}>{t.adminPtSubtitle}</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button className="btn btn-ghost" onClick={() => setScanning(true)}>
            <QrCode size={18} /> {t.adminPtScanAssign}
          </button>
          <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
            <Plus size={18} /> {t.adminPtNewGroup}
          </button>
        </div>
      </div>

      {creating && (
        <div className="stat-card" style={{ padding: 20, marginBottom: 20, display: "flex", flexDirection: "column", gap: 14, maxWidth: 560 }}>
          <div className="field">
            <label className="label" htmlFor="pt-group-name">{t.adminPtGroupName}</label>
            <input
              id="pt-group-name"
              className="input"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.adminPtGroupNamePlaceholder}
              autoFocus
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="pt-group-desc">{t.adminPtGroupDescription}</label>
            <textarea id="pt-group-desc" className="input" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setCreating(false)} disabled={saving}>{t.adminPtCancel}</button>
            <button className="btn btn-primary" onClick={() => void create()} disabled={saving || !name.trim()}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : t.adminPtCreate}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "48px 0", color: "var(--text-muted)", fontSize: 14 }}>
          <Loader2 size={18} className="animate-spin" /> {t.adminPtLoading}
        </div>
      ) : error && groups.length === 0 ? (
        <div className="stat-card" style={{ textAlign: "center", padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <p style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)" }}>{t.adminPtLoadError}</p>
          <button className="btn btn-ghost" onClick={() => { setLoading(true); void load(); }}>{t.adminPtRetry}</button>
        </div>
      ) : visible.length === 0 ? (
        <div className="stat-card" style={{ textAlign: "center", padding: "56px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <PackageOpen size={40} style={{ color: "var(--text-muted)" }} />
          <p style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)" }}>{t.adminPtEmptyGroups}</p>
        </div>
      ) : (
        <ul style={{ display: "flex", flexDirection: "column", gap: 12, listStyle: "none" }}>
          {visible.map((g) => (
            <li key={g.id}>
              <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
              <Link
                href={`/admin/property-tags/${g.id}`}
                className="stat-card"
                style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 12, textDecoration: "none", flex: 1, minWidth: 0 }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{g.name}</h2>
                    {g.status === "archived" && <span className="badge badge-yellow">{t.adminPtArchived}</span>}
                  </div>
                  {g.description && (
                    <p style={{ marginTop: 4, fontSize: 13, color: "var(--text-secondary)", overflowWrap: "anywhere" }}>{g.description}</p>
                  )}
                  <p style={{ marginTop: 6, fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>
                    {t.adminPtAssignedCount.replace("{assigned}", String(g.assigned)).replace("{total}", String(g.total))}
                  </p>
                </div>
                <ChevronRight size={18} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              </Link>
              <button
                className="btn btn-ghost"
                onClick={() => { setDeleteNotice(null); setConfirmDelete(confirmDelete === g.id ? null : g.id); }}
                aria-label={`${t.adminPtDelete}: ${g.name}`}
                title={t.adminPtDelete}
                style={{ color: "var(--red-600)", flexShrink: 0 }}
              >
                <Trash2 size={18} />
              </button>
              </div>
              {confirmDelete === g.id && (
                <div style={{ marginTop: 8, borderRadius: 16, padding: 16, background: "rgb(var(--red-500-rgb) / 0.08)", border: "1px solid rgb(var(--red-500-rgb) / 0.3)", display: "flex", flexDirection: "column", gap: 12 }}>
                  <p style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.5 }}>
                    {t.adminPtDeleteConfirm.replace("{name}", g.name).replace("{total}", String(g.total))}
                  </p>
                  {deleteNotice && <p role="alert" style={{ fontSize: 13.5, fontWeight: 700, color: "var(--red-600)" }}>{deleteNotice}</p>}
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)} disabled={deleting}>{t.adminPtCancel}</button>
                    <button className="btn btn-danger" onClick={() => void deleteGroup(g)} disabled={deleting}>
                      {deleting ? <Loader2 size={16} className="animate-spin" /> : t.adminPtDeleteBtn}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {archivedCount > 0 && (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 13.5, color: "var(--text-secondary)", cursor: "pointer" }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {t.adminPtShowArchived} ({archivedCount})
        </label>
      )}

      {scanning && <PropertyTagPanel onChanged={load} onClose={() => setScanning(false)} />}
    </div>
  );
}
