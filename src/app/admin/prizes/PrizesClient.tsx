"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PrizeAwardPanel from "./PrizeAwardPanel";
import { Gift, Plus, QrCode, FileSpreadsheet, Printer, Loader2, ImageOff, Lock, PackageOpen, Pencil, Camera, Check, ImagePlus, Trash2, AlertTriangle, Search } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { compressImageFile } from "@/lib/media/compress-image";
import { uploadFormViaXHR } from "@/lib/media/xhr-upload";
import {
  PageHeader,
  Toolbar,
  Modal,
  Field,
  IconButton,
  InlineAlert,
  StatusBadge,
  LoadingState,
  EmptyState,
  ErrorState,
  useToast,
} from "@/components/admin/ui";

// /admin/prizes — the top-level prize tab.
//
// It is top-level, not a pane under an event, because a prize is not owned by an
// event: แจกแก้ว is handed out at the event AND at a counter days later, and the
// "one per student" guarantee has to span both. See docs/features/prize-claim.md.
//
// UI note: this app is light-only by design (globals.css sets `color-scheme:
// only light` so a phone's OS dark mode can't algorithmically invert the
// black-on-white attendance QR into something a scanner can't read — see
// /dashboard/id). So this file deliberately has NO `dark:` Tailwind classes —
// it reuses the shared admin kit (@/components/admin/ui) and CSS var tokens.

interface PrizeRow {
  id: string;
  name: string;
  eventId: string | null;
  rank: number | null;
  quantity: number | null;
  onePerStudent: boolean;
  requireCheckIn: boolean;
  eligibilityEventId: string | null;
  status: "open" | "closed";
  claimCount?: number;
  awaitingPhotoCount?: number;
}

interface EventOption {
  id: string;
  title: string;
}

// Below this many prizes a search box is noise; above it, finding one prize at a
// busy booth gets slow.
const TOOLBAR_MIN_PRIZES = 6;

export default function PrizesClient({ canAward, canManage, isSuperAdmin }: { canAward: boolean; canManage: boolean; isSuperAdmin: boolean }) {
  const { t } = useLanguage();
  const [prizes, setPrizes] = useState<PrizeRow[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [canExport, setCanExport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [awarding, setAwarding] = useState<PrizeRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PrizeRow | null>(null);
  const [awaitingPhotoPrize, setAwaitingPhotoPrize] = useState<PrizeRow | null>(null);
  const [deleting, setDeleting] = useState<PrizeRow | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">("all");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/prizes");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPrizes(data.prizes ?? []);
      setCanExport(!!data.canExport);
      setLoadFailed(false);
    } catch {
      setPrizes([]);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred via setTimeout so the setState calls fire after this render
    // commits rather than synchronously within the effect — mirrors
    // admin/majors/page.tsx and admin/clubs/page.tsx
    // (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!canManage) return;
    // Only the create/edit form needs the event list; an award-only staffer
    // never sees it.
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/admin/events");
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.events ?? [];
        setEvents(list.map((e: EventOption) => ({ id: e.id, title: e.title })));
      } catch {
        setEvents([]);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [canManage]);

  const q = query.trim().toLowerCase();
  const visible = prizes.filter((p) => (statusFilter === "all" || p.status === statusFilter) && (!q || p.name.toLowerCase().includes(q)));
  const filtering = q !== "" || statusFilter !== "all";

  return (
    <div className="pb-20">
      <PageHeader
        title={t.adminPrizesTitle}
        description={t.adminPrizesSubtitle}
        actions={
          canManage ? (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={18} aria-hidden="true" /> {t.adminPrizesCreate}
            </button>
          ) : undefined
        }
      />

      {!canManage && (
        <div style={{ marginBottom: 20 }}>
          <InlineAlert tone="info">
            <span style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <Lock size={16} aria-hidden="true" style={{ marginTop: 4, flexShrink: 0 }} />
              <span>
                {t.adminPrizesAwardOnlyNotice}
                {canAward && <> {t.adminPrizesAwardOnlyAwaitingNote}</>}
              </span>
            </span>
          </InlineAlert>
        </div>
      )}

      {loading ? (
        <LoadingState variant="skeleton" rows={3} label={t.adminPrizesLoading} />
      ) : loadFailed ? (
        <ErrorState message={t.adminPtPrzLoadError} onRetry={() => { setLoading(true); void load(); }} />
      ) : prizes.length === 0 ? (
        <EmptyState
          icon={<PackageOpen size={24} />}
          title={t.adminPrizesEmptyTitle}
          description={canManage ? t.adminPrizesEmptyHintManage : t.adminPrizesEmptyHintAward}
          action={
            canManage ? (
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={18} aria-hidden="true" /> {t.adminPrizesCreate}
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          {prizes.length >= TOOLBAR_MIN_PRIZES && (
            <Toolbar>
              <input
                className="input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.adminPtPrzSearch}
                aria-label={t.adminPtPrzSearch}
              />
              <select
                className="input"
                style={{ width: "auto", flex: "0 0 auto" }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "all" | "open" | "closed")}
                aria-label={t.adminPrizesStatusField}
              >
                <option value="all">{t.adminPtPrzFilterAll}</option>
                <option value="open">{t.adminPrizesStatusOptionOpen}</option>
                <option value="closed">{t.adminPrizesStatusOptionClosed}</option>
              </select>
            </Toolbar>
          )}

          {visible.length === 0 ? (
            <EmptyState
              compact
              icon={<Search size={24} />}
              title={t.adminPtPrzNoMatch}
              action={
                filtering ? (
                  <button className="btn btn-ghost" onClick={() => { setQuery(""); setStatusFilter("all"); }}>
                    {t.adminPtPrzClearFilters}
                  </button>
                ) : undefined
              }
            />
          ) : (
            <ul style={{ display: "flex", flexDirection: "column", gap: 12, listStyle: "none" }}>
              {visible.map((p) => {
                const overQuantity = p.quantity !== null && (p.claimCount ?? 0) > p.quantity;
                return (
                  <li key={p.id} className="stat-card" style={{ padding: "18px 20px" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
                      <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                          <h2 style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.4, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{p.name}</h2>
                          {p.status === "closed" ? (
                            <StatusBadge tone="neutral" icon={<Lock size={12} />}>{t.adminPrizesClosedBadge}</StatusBadge>
                          ) : (
                            <StatusBadge tone="success">{t.adminPrizesStatusOptionOpen}</StatusBadge>
                          )}
                          {p.onePerStudent && <StatusBadge tone="info" icon={false}>{t.adminPrizesOnePerStudentBadge}</StatusBadge>}
                          {p.requireCheckIn && <StatusBadge tone="info" icon={false}>{t.adminPrizesRequireCheckInBadge}</StatusBadge>}
                        </div>

                        {/* canAward, not canManage: claimCount/awaitingPhotoCount are
                            aggregate numbers with no student's name in them — "how
                            many have gone out" and "how much of the booth's own work
                            is unfinished" — so an award-only role (smo) gets this line
                            and the รอรูป follow-up button too. The winner ROLL and the
                            Edit button below stay canManage-only. */}
                        {canAward && (
                          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 12px", fontSize: 14, lineHeight: 1.5, color: "var(--text-secondary)" }}>
                            <span>
                              {p.quantity !== null
                                ? t.adminPrizesAwardedCountWithTarget.replace("{count}", String(p.claimCount ?? 0)).replace("{target}", String(p.quantity))
                                : t.adminPrizesAwardedCount.replace("{count}", String(p.claimCount ?? 0))}
                            </span>
                            {/* Over-quantity is a WARNING, never a block: real events
                                over-award, and blocking at the booth makes staff stop
                                RECORDING rather than stop awarding. */}
                            {overQuantity && <StatusBadge tone="warning">{t.adminPrizesOverQuantity}</StatusBadge>}
                            {!!p.awaitingPhotoCount && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                style={{ color: "var(--amber-700)" }}
                                onClick={() => setAwaitingPhotoPrize(p)}
                              >
                                <ImageOff size={14} aria-hidden="true" /> {t.adminPrizesAwaitingPhoto.replace("{count}", String(p.awaitingPhotoCount))}
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                        {canManage && (
                          <button className="btn btn-ghost" onClick={() => setEditing(p)}>
                            <Pencil size={16} aria-hidden="true" /> {t.edit}
                          </button>
                        )}
                        {canExport && (
                          <>
                            <a href={`/api/admin/prizes/${p.id}/export`} className="btn btn-ghost">
                              <FileSpreadsheet size={16} aria-hidden="true" /> {t.adminPtPrzExportExcel}
                            </a>
                            <a href={`/admin/prizes/${p.id}/report`} className="btn btn-ghost">
                              <Printer size={16} aria-hidden="true" /> {t.adminPtPrzExportPdf}
                            </a>
                          </>
                        )}
                        {canAward && p.status === "open" && (
                          <button className="btn btn-success-solid" onClick={() => setAwarding(p)}>
                            <QrCode size={16} aria-hidden="true" /> {t.adminPrizesAwardBtn}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Irreversible + cascades every claim and proof photo, so it sits
                        in its own row, away from Award, and is confirmed in a dialog. */}
                    {isSuperAdmin && (
                      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end" }}>
                        <IconButton
                          size="sm"
                          tone="danger"
                          label={t.adminPtPrzDeleteAria.replace("{name}", p.name)}
                          icon={<Trash2 size={18} />}
                          onClick={() => setDeleting(p)}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {awarding && (
        <PrizeAwardPanel
          prizeId={awarding.id}
          prizeName={awarding.name}
          onClaimed={load}
          onClose={() => setAwarding(null)}
        />
      )}

      {creating && (
        <PrizeFormDialog
          events={events}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void load();
          }}
        />
      )}

      {editing && (
        <PrizeFormDialog
          prize={editing}
          events={events}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      {awaitingPhotoPrize && (
        <AwaitingPhotoDialog
          prizeId={awaitingPhotoPrize.id}
          prizeName={awaitingPhotoPrize.name}
          onClose={() => setAwaitingPhotoPrize(null)}
          onAttached={load}
        />
      )}

      {deleting && (
        <DeletePrizeDialog
          prize={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            void load();
          }}
          onCloseInstead={() => {
            setDeleting(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function PrizeFormDialog({
  prize,
  events,
  onClose,
  onSaved,
}: {
  prize?: PrizeRow;
  events: EventOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const isEdit = !!prize;
  const [name, setName] = useState(prize?.name ?? "");
  const [eventId, setEventId] = useState(prize?.eventId ?? "");
  const [quantity, setQuantity] = useState(prize?.quantity != null ? String(prize.quantity) : "");
  const [onePerStudent, setOnePerStudent] = useState(prize?.onePerStudent ?? true);
  const [requireCheckIn, setRequireCheckIn] = useState(prize?.requireCheckIn ?? false);
  const [eligibilityEventId, setEligibilityEventId] = useState(prize?.eligibilityEventId ?? "");
  const [status, setStatus] = useState<"open" | "closed">(prize?.status ?? "open");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(isEdit ? `/api/admin/prizes/${prize!.id}` : "/api/admin/prizes", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          eventId: eventId || null,
          quantity: quantity === "" ? null : Number(quantity),
          onePerStudent,
          requireCheckIn,
          eligibilityEventId: requireCheckIn ? eligibilityEventId || null : null,
          ...(isEdit ? { status } : {}),
        }),
      });
      if (!res.ok) throw new Error();
      toast.success((isEdit ? t.adminPtPrzUpdatedToast : t.adminPtPrzCreatedToast).replace("{name}", name.trim()));
      onSaved();
    } catch {
      setError(t.adminPrizesSaveError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!saving}
      size="md"
      icon={<Gift size={20} />}
      title={isEdit ? t.adminPrizesEditTitle : t.adminPrizesCreate}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>{t.cancel}</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving || !name.trim()}>
            {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {saving ? t.saving : isEdit ? t.saveChanges : t.adminPrizesSubmit}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <Field label={t.adminPrizesFieldName.replace(/\s*\*$/, "")} required>
          {(p) => (
            <input
              {...p}
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              placeholder={t.adminPrizesFieldNamePlaceholder}
            />
          )}
        </Field>

        <Field label={t.adminPrizesFieldEvent}>
          {(p) => (
            <select {...p} className="input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">{t.adminPrizesFieldEventNone}</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>{e.title}</option>
              ))}
            </select>
          )}
        </Field>

        <Field label={t.adminPrizesFieldQuantity} hint={t.adminPrizesFieldQuantityHint}>
          {(p) => (
            <input
              {...p}
              className="input"
              type="number"
              min={0}
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          )}
        </Field>

        <p className="section-title" style={{ margin: "4px 0 -6px" }}>{t.adminPrizesSettingsSection}</p>

        <ToggleRow
          checked={onePerStudent}
          onChange={setOnePerStudent}
          title={t.adminPrizesOnePerStudentTitle}
          hint={t.adminPrizesOnePerStudentHint}
        />

        <ToggleRow
          checked={requireCheckIn}
          onChange={setRequireCheckIn}
          title={t.adminPrizesRequireCheckInTitle}
        />

        {requireCheckIn && (
          <Field label={t.adminPrizesEligibilityLabel} hint={t.adminPrizesEligibilityHint}>
            {(p) => (
              <select {...p} className="input" value={eligibilityEventId} onChange={(e) => setEligibilityEventId(e.target.value)}>
                <option value="">{t.adminPrizesSelectEvent}</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>{e.title}</option>
                ))}
              </select>
            )}
          </Field>
        )}

        {isEdit && (
          <Field label={t.adminPrizesStatusField}>
            {(p) => (
              <select {...p} className="input" value={status} onChange={(e) => setStatus(e.target.value as "open" | "closed")}>
                <option value="open">{t.adminPrizesStatusOptionOpen}</option>
                <option value="closed">{t.adminPrizesStatusOptionClosed}</option>
              </select>
            )}
          </Field>
        )}

        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Modal>
  );
}

interface AwaitingPhotoClaim {
  claimId: string;
  name: string;
  studentId: string | null;
  claimedAt: string;
}

// The "รอรูป" follow-up: claims that were confirmed at the booth but never got
// a proof photo (venue wifi died mid-upload, staff moved on to the next
// person, etc). Before this dialog existed, PrizeAwardPanel's own failure copy
// promised "attach it later from the awaiting photos list" but no such list
// was reachable anywhere — this is that missing other half.
function AwaitingPhotoDialog({
  prizeId,
  prizeName,
  onClose,
  onAttached,
}: {
  prizeId: string;
  prizeName: string;
  onClose: () => void;
  onAttached: () => void;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [claims, setClaims] = useState<AwaitingPhotoClaim[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  // One hidden input per source, shared by every row: the row's button records
  // which claim the picker is for. A real <button> (not a <label> around a
  // display:none input) keeps the control reachable by keyboard.
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const pickingForRef = useRef<AwaitingPhotoClaim | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/prizes/${prizeId}/awaiting-photo`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t.adminPrizesConnectionError);
      setClaims(Array.isArray(body.claims) ? body.claims : []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t.adminPrizesConnectionError);
    } finally {
      setLoading(false);
    }
  }, [prizeId, t.adminPrizesConnectionError]);

  useEffect(() => {
    // Deferred via setTimeout so the setState calls fire after this render
    // commits rather than synchronously within the effect — mirrors the
    // top-level load() effect above (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function attach(claim: AwaitingPhotoClaim, file: File) {
    setUploadingId(claim.claimId);
    try {
      const compressed = await compressImageFile(file);
      // See PrizeAwardPanel.tsx's uploadPhoto for the full story: confirmed on
      // iOS the server sometimes gets a well-formed multipart Content-Type but
      // Content-Length: 0 — this check surfaces, right on the staff's own
      // screen, whether the blob was already empty before any network call.
      if (compressed.size === 0) {
        throw new Error(t.adminPtPrzPhotoEmpty);
      }
      const form = new FormData();
      // uploadFormViaXHR (src/lib/xhr-upload.ts) re-materializes every
      // File/Blob before sending — see PrizeAwardPanel.tsx for why.
      form.append("file", compressed);
      const up = await uploadFormViaXHR("/api/forms/upload", form);
      if (!up.ok) throw new Error((up.body.error as string) || t.adminPrizesConnectionError);

      const attachRes = await fetch(`/api/admin/prizes/claims/${claim.claimId}/photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoKey: up.body.key }),
      });
      if (!attachRes.ok) throw new Error(t.adminPrizesConnectionError);

      setDoneIds((prev) => new Set(prev).add(claim.claimId));
      toast.success(t.adminPtPrzPhotoAttachedToast.replace("{name}", claim.name));
      onAttached();
    } catch (e) {
      toast.error(t.adminPtPrzPhotoFailedTitle, e instanceof Error ? e.message : t.adminPrizesConnectionError);
    } finally {
      setUploadingId(null);
    }
  }

  function openPicker(claim: AwaitingPhotoClaim, source: "camera" | "gallery") {
    pickingForRef.current = claim;
    (source === "camera" ? cameraInputRef : galleryInputRef).current?.click();
  }

  function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    const claim = pickingForRef.current;
    // Reset so choosing the same file again after a failure still fires onChange.
    e.target.value = "";
    if (f && claim) void attach(claim, f);
  }

  const remaining = claims.filter((c) => !doneIds.has(c.claimId));
  const uploading = uploadingId !== null;

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!uploading}
      size="md"
      icon={<ImageOff size={20} />}
      title={t.adminPrizesAwaitingPhotoDialogTitle}
      description={
        <>
          <strong>{prizeName}</strong>
          {" — "}
          {t.adminPtPrzAwaitingCaption}
        </>
      }
      footer={<button className="btn btn-primary" onClick={onClose} disabled={uploading}>{t.adminUiClose}</button>}
    >
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={onPicked} />
      <input ref={galleryInputRef} type="file" accept="image/*" hidden onChange={onPicked} />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {loading ? (
          <LoadingState compact label={t.adminPrizesLoading} />
        ) : loadError ? (
          <ErrorState compact message={loadError} onRetry={() => void load()} />
        ) : remaining.length === 0 ? (
          <EmptyState compact icon={<Check size={24} />} title={t.adminPrizesAwaitingPhotoEmpty} />
        ) : (
          remaining.map((c) => {
            const busyRow = uploadingId === c.claimId;
            return (
              <div
                key={c.claimId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", overflowWrap: "break-word" }}>{c.name}</p>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                    {c.studentId ?? t.adminPrizesNoStudentId}
                    {" · "}
                    {t.adminPrizesClaimedAt.replace("{date}", new Date(c.claimedAt).toLocaleString("th-TH"))}
                  </p>
                </div>

                {/* Two icon buttons rather than one text-labelled one: Android
                    OEM pickers only reliably open the camera with
                    capture="environment", so camera and gallery stay separate. */}
                <div role="group" aria-label={`${t.adminPrizesAwaitingPhotoAttachBtn}: ${c.name}`} style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <IconButton
                    tone="accent"
                    label={`${t.adminPrizesPhotoCtaCamera}: ${c.name}`}
                    icon={busyRow ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                    disabled={uploading}
                    onClick={() => openPicker(c, "camera")}
                  />
                  <IconButton
                    label={`${t.adminPrizesPhotoCtaGallery}: ${c.name}`}
                    icon={<ImagePlus size={18} />}
                    disabled={uploading}
                    onClick={() => openPicker(c, "gallery")}
                  />
                </div>
              </div>
            );
          })
        )}

        {!!doneIds.size && !loading && remaining.length > 0 && (
          <p role="status" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "var(--teal-600)" }}>
            <Check size={14} aria-hidden="true" /> {t.adminPrizesPhotoAttached} ({doneIds.size})
          </p>
        )}
      </div>
    </Modal>
  );
}

// A tappable card-style toggle rather than a bare checkbox + label: matches
// the "allowed years" selector on admin/events/page.tsx (48px min-height,
// highlighted border when active) so this is comfortable to hit with a thumb
// at a booth, and the checked state is legible at a glance, not just from the
// tiny checkbox square.
function ToggleRow({
  checked,
  onChange,
  title,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  hint?: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        minHeight: 48,
        padding: "13px 16px",
        borderRadius: 16,
        background: "var(--bg-elevated)",
        border: `1.5px solid ${checked ? "var(--accent-primary)" : "transparent"}`,
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 20, height: 20, marginTop: 1, flexShrink: 0, accentColor: "var(--accent-primary)", cursor: "pointer" }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{title}</span>
        {hint && <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.5 }}>{hint}</span>}
      </span>
    </label>
  );
}

// super_admin-only, irreversible: DELETE /api/admin/prizes/[id] cascades every
// claim row AND deletes every proof photo object from the private bucket (see
// that route's own comment — it reads every photoKey before the cascade so
// nothing is orphaned). There is no stored PDF/Excel to also clean up — both
// are generated on demand from the claims, so once they're gone neither can be
// regenerated; the dialog says this explicitly rather than silently implying
// "documents deleted too". A prize that has ever been claimed requires typing
// its name to enable the button (GitHub-style, but nothing else in this app
// has a delete this destructive yet, so there's no existing pattern to match);
// an unclaimed prize can be removed on a plain confirm. "Close instead" is
// offered first and more prominently — PATCHing status:"closed" is what the
// DELETE route's own comment says the UI *should* be pushing people toward.
function DeletePrizeDialog({
  prize,
  onClose,
  onDeleted,
  onCloseInstead,
}: {
  prize: PrizeRow;
  onClose: () => void;
  onDeleted: () => void;
  onCloseInstead: () => void;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const claimCount = prize.claimCount ?? 0;
  const awaitingPhotoCount = prize.awaitingPhotoCount ?? 0;
  const photoCount = Math.max(0, claimCount - awaitingPhotoCount);
  const requiresTypedConfirm = claimCount > 0;
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState<"delete" | "close" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const canDelete = !requiresTypedConfirm || confirmText.trim() === prize.name;

  async function doDelete() {
    if (!canDelete || busy) return;
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(`/api/admin/prizes/${prize.id}`, { method: "DELETE" });
      // Always the translated fallback, never the server's raw (English-only)
      // error string — matches doCloseInstead right below and PrizeFormDialog's
      // submit() elsewhere in this file. The DELETE route's error bodies
      // ("Unauthorized"/"Forbidden"/"Prize not found"/"Invalid prize id") are
      // untranslated and would otherwise leak literal English into a TH/MM/CN
      // admin's UI on a race (e.g. the prize was already deleted by someone
      // else between page load and this click).
      if (!res.ok) throw new Error(t.adminPtPrzActionFailed);
      toast.success(t.adminPtPrzDeletedToast.replace("{name}", prize.name));
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.adminPtPrzActionFailed);
      setBusy(null);
    }
  }

  async function doCloseInstead() {
    if (busy) return;
    setBusy("close");
    setError(null);
    try {
      const res = await fetch(`/api/admin/prizes/${prize.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });
      if (!res.ok) throw new Error(t.adminPtPrzActionFailed);
      toast.success(t.adminPtPrzClosedToast.replace("{name}", prize.name));
      onCloseInstead();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.adminPtPrzActionFailed);
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      size="sm"
      icon={<AlertTriangle size={20} />}
      title={`${t.adminPrizesDeleteTitle}: ${prize.name}`}
      initialFocusRef={cancelRef}
      footer={
        <>
          <button ref={cancelRef} className="btn btn-ghost" onClick={onClose} disabled={!!busy}>{t.cancel}</button>
          <button className="btn adm-btn-danger-solid" onClick={doDelete} disabled={!!busy || !canDelete}>
            {busy === "delete" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />} {t.adminPrizesDeleteConfirmBtn}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p className="adm-modal-text" style={{ color: "var(--text-primary)" }}>
          {t.adminPrizesDeleteWarning
            .replace("{claims}", String(claimCount))
            .replace("{photos}", String(photoCount))}
        </p>
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
          {t.adminPrizesDeleteNoDocsNotice}
        </p>

        <div style={{ borderRadius: 16, padding: 16, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{t.adminPrizesDeleteCloseInsteadTitle}</p>
          <p style={{ marginTop: 4, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>{t.adminPrizesDeleteCloseInsteadHint}</p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={doCloseInstead} disabled={!!busy}>
            {busy === "close" && <Loader2 size={16} className="animate-spin" aria-hidden="true" />} {t.adminPrizesDeleteCloseInsteadBtn}
          </button>
        </div>

        {requiresTypedConfirm && (
          <Field label={t.adminPrizesDeleteTypeToConfirm.replace("{name}", prize.name)}>
            {(p) => (
              <input
                {...p}
                className="input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={prize.name}
                disabled={!!busy}
                autoComplete="off"
              />
            )}
          </Field>
        )}

        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Modal>
  );
}
