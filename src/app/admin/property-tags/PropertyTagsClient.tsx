"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, PackageOpen, Plus, QrCode, Search, Tag, Trash2 } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import {
  PageHeader,
  Toolbar,
  Modal,
  Field,
  IconButton,
  StatusBadge,
  LoadingState,
  EmptyState,
  ErrorState,
  useConfirm,
  useToast,
} from "@/components/admin/ui";
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
  const toast = useToast();
  const confirm = useConfirm();
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  function closeCreate() {
    if (saving) return;
    setCreating(false);
    setName("");
    setDescription("");
  }

  async function create() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/property-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      });
      if (!res.ok) throw new Error();
      const { id } = await res.json();
      toast.success(t.adminPtUiGroupCreated.replace("{name}", name.trim()));
      router.push(`/admin/property-tags/${id}`);
    } catch {
      setSaving(false);
      toast.error(t.adminPtUiCreateFailed);
    }
  }

  async function deleteGroup(g: GroupRow) {
    const ok = await confirm({
      title: `${t.adminPtDelete}: ${g.name}`,
      message: t.adminPtDeleteConfirm.replace("{name}", g.name).replace("{total}", String(g.total)),
      confirmLabel: t.adminPtDelete,
      tone: "danger",
    });
    if (!ok) return;
    setDeletingId(g.id);
    try {
      const res = await fetch(`/api/admin/property-tags/${g.id}`, { method: "DELETE" });
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        toast.error(
          t.adminPtUiDeleteBlockedTitle,
          t.adminPtDeleteBlocked.replace("{n}", String(data.assigned ?? g.assigned)),
        );
        return;
      }
      if (!res.ok && res.status !== 404) throw new Error();
      toast.success(t.adminPtUiGroupDeleted.replace("{name}", g.name));
      await load();
    } catch {
      toast.error(t.adminPtUiDeleteFailed);
    } finally {
      setDeletingId(null);
    }
  }

  const q = query.trim().toLowerCase();
  const visible = groups.filter(
    (g) => (showArchived || g.status === "open") && (!q || g.name.toLowerCase().includes(q) || (g.description ?? "").toLowerCase().includes(q)),
  );
  const archivedCount = groups.filter((g) => g.status === "archived").length;

  return (
    <div className="pb-20">
      <PageHeader
        title={t.adminPropertyTags}
        description={t.adminPtSubtitle}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setScanning(true)}>
              <QrCode size={18} aria-hidden="true" /> {t.adminPtScanAssign}
            </button>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={18} aria-hidden="true" /> {t.adminPtNewGroup}
            </button>
          </>
        }
      />

      {loading ? (
        <LoadingState variant="skeleton" rows={3} label={t.adminPtLoading} />
      ) : error && groups.length === 0 ? (
        <ErrorState message={t.adminPtLoadError} onRetry={() => { setLoading(true); void load(); }} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<PackageOpen size={24} />}
          title={t.adminPtUiEmptyTitle}
          description={t.adminPtUiEmptyHint}
          action={
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={18} aria-hidden="true" /> {t.adminPtNewGroup}
            </button>
          }
        />
      ) : (
        <>
          <Toolbar>
            <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 360 }}>
              <Search size={16} aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input
                className="input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.adminPtUiSearchGroups}
                aria-label={t.adminPtUiSearchGroups}
                style={{ paddingLeft: 36 }}
              />
            </div>
            {archivedCount > 0 && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, fontSize: 14, color: "var(--text-secondary)", cursor: "pointer" }}>
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} style={{ width: 18, height: 18 }} />
                {t.adminPtShowArchived} ({archivedCount})
              </label>
            )}
          </Toolbar>

          {visible.length === 0 ? (
            <EmptyState
              compact
              icon={<Search size={24} />}
              title={t.adminPtNoMatch}
              description={!q && archivedCount > 0 ? t.adminPtUiOnlyArchived : undefined}
            />
          ) : (
            <ul style={{ display: "flex", flexDirection: "column", gap: 12, listStyle: "none" }}>
              {visible.map((g) => (
                <li key={g.id} style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
                  <Link
                    href={`/admin/property-tags/${g.id}`}
                    className="stat-card"
                    style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 12, textDecoration: "none", flex: 1, minWidth: 0 }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                        <h2 style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.4, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{g.name}</h2>
                        {g.status === "archived" && <StatusBadge tone="warning" icon={false}>{t.adminPtArchived}</StatusBadge>}
                        {g.status === "open" && g.total > 0 && g.assigned === g.total && <StatusBadge tone="success">{t.adminPtUiAllAssigned}</StatusBadge>}
                      </div>
                      {g.description && (
                        <p style={{ marginTop: 4, fontSize: 14, lineHeight: 1.5, color: "var(--text-secondary)", overflowWrap: "anywhere" }}>{g.description}</p>
                      )}
                      <p style={{ marginTop: 6, fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>
                        {t.adminPtAssignedCount.replace("{assigned}", String(g.assigned)).replace("{total}", String(g.total))}
                      </p>
                    </div>
                    <ChevronRight size={18} aria-hidden="true" style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  </Link>
                  <IconButton
                    tone="danger"
                    label={`${t.adminPtDelete}: ${g.name}`}
                    icon={deletingId === g.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                    disabled={deletingId !== null}
                    onClick={() => void deleteGroup(g)}
                    style={{ alignSelf: "center" }}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Modal
        open={creating}
        onClose={closeCreate}
        dismissible={!saving}
        size="md"
        icon={<Tag size={20} />}
        title={t.adminPtNewGroup}
        footer={
          <>
            <button className="btn btn-ghost" onClick={closeCreate} disabled={saving}>{t.adminPtCancel}</button>
            <button className="btn btn-primary" onClick={() => void create()} disabled={saving || !name.trim()}>
              {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {t.adminPtCreate}
            </button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Field label={t.adminPtGroupName} required>
            {(p) => (
              <input
                {...p}
                className="input"
                value={name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
                placeholder={t.adminPtGroupNamePlaceholder}
              />
            )}
          </Field>
          <Field label={t.adminPtGroupDescription}>
            {(p) => <textarea {...p} className="input" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
        </div>
      </Modal>

      {scanning && <PropertyTagPanel onChanged={load} onClose={() => setScanning(false)} />}
    </div>
  );
}
