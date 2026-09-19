"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import PrizeAwardPanel from "./PrizeAwardPanel";
import { Gift, Plus, QrCode, FileSpreadsheet, Printer, Loader2, ImageOff, Lock, X, PackageOpen } from "lucide-react";

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
// it reuses the same .btn/.input/.field/.badge system and CSS var tokens as
// every other admin page (see globals.css and admin/clubs/page.tsx).

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

export default function PrizesClient({ canAward, canManage }: { canAward: boolean; canManage: boolean }) {
  const [prizes, setPrizes] = useState<PrizeRow[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [canExport, setCanExport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [awarding, setAwarding] = useState<PrizeRow | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/prizes");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPrizes(data.prizes ?? []);
      setCanExport(!!data.canExport);
    } catch {
      setPrizes([]);
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

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "24px 20px 56px" }}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 24 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "clamp(22px, 4vw, 26px)", fontWeight: 900, color: "var(--text-primary)" }}>
            <Gift size={26} style={{ color: "var(--accent-primary)", flexShrink: 0 }} /> การรับรางวัล
          </h1>
          <p style={{ marginTop: 6, fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            บันทึกการแจกของรางวัลพร้อมรูปหลักฐาน ใช้ได้ทั้งแจกในงานและแจกนอกรอบ
          </p>
        </div>
        {canManage && (
          <button className="btn btn-primary btn-lg" onClick={() => setCreating(true)} style={{ flexShrink: 0 }}>
            <Plus size={18} /> สร้างรางวัล
          </button>
        )}
      </header>

      {!canManage && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
            padding: "14px 16px",
            marginBottom: 20,
            fontSize: 13,
            color: "var(--text-secondary)",
            lineHeight: 1.5,
          }}
        >
          <Lock size={16} style={{ marginTop: 2, flexShrink: 0, color: "var(--text-muted)" }} />
          คุณมีสิทธิ์แจกรางวัลและถ่ายรูปเท่านั้น การสร้างรางวัลและการออกรายงานต้องใช้สิทธิ์ผู้ดูแล
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "48px 0", color: "var(--text-muted)", fontSize: 14 }}>
          <Loader2 size={18} className="animate-spin" /> กำลังโหลด…
        </div>
      ) : prizes.length === 0 ? (
        <div className="stat-card" style={{ textAlign: "center", padding: "56px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <PackageOpen size={40} style={{ color: "var(--text-muted)" }} />
          <p style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)" }}>ยังไม่มีรางวัล</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 320, lineHeight: 1.5 }}>
            {canManage ? "กด \"สร้างรางวัล\" ด้านบนเพื่อเริ่มบันทึกการแจก" : "รอแอดมินสร้างรางวัลก่อน ถึงจะเริ่มแจกได้"}
          </p>
        </div>
      ) : (
        <ul style={{ display: "flex", flexDirection: "column", gap: 12, listStyle: "none" }}>
          {prizes.map((p) => {
            const overQuantity = p.quantity !== null && (p.claimCount ?? 0) > p.quantity;
            return (
              <li key={p.id} className="stat-card" style={{ padding: "18px 20px" }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                      <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>{p.name}</h2>
                      {p.status === "closed" && (
                        <span className="badge" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border-subtle)" }}>
                          ปิดรับ
                        </span>
                      )}
                      {p.onePerStudent && <span className="badge badge-blue">1 คน / 1 ชิ้น</span>}
                      {p.requireCheckIn && <span className="badge badge-purple">ต้องเช็คอินก่อน</span>}
                    </div>

                    {canManage && (
                      <p style={{ marginTop: 6, fontSize: 13, color: "var(--text-secondary)" }}>
                        แจกแล้ว {p.claimCount ?? 0}
                        {p.quantity !== null ? ` / ${p.quantity}` : ""} ชิ้น
                        {/* Over-quantity is a WARNING, never a block: real events
                            over-award, and blocking at the booth makes staff stop
                            RECORDING rather than stop awarding. */}
                        {overQuantity && <span style={{ marginLeft: 8, fontWeight: 700, color: "#b45309" }}>เกินจำนวนที่ตั้งไว้</span>}
                        {!!p.awaitingPhotoCount && (
                          <span style={{ marginLeft: 8, display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 700, color: "#b45309" }}>
                            <ImageOff size={13} /> รอรูป {p.awaitingPhotoCount}
                          </span>
                        )}
                      </p>
                    )}
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {canAward && p.status === "open" && (
                      <button className="btn btn-success-solid" onClick={() => setAwarding(p)}>
                        <QrCode size={16} /> แจกรางวัล
                      </button>
                    )}
                    {canExport && (
                      <>
                        <a href={`/api/admin/prizes/${p.id}/export`} className="btn btn-ghost">
                          <FileSpreadsheet size={16} /> Excel
                        </a>
                        <a href={`/admin/prizes/${p.id}/report`} className="btn btn-ghost">
                          <Printer size={16} /> PDF
                        </a>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
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
        <CreatePrizeDialog
          events={events}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function CreatePrizeDialog({
  events,
  onClose,
  onCreated,
}: {
  events: EventOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [eventId, setEventId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [onePerStudent, setOnePerStudent] = useState(true);
  const [requireCheckIn, setRequireCheckIn] = useState(false);
  const [eligibilityEventId, setEligibilityEventId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/prizes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          eventId: eventId || null,
          quantity: quantity === "" ? null : Number(quantity),
          onePerStudent,
          requireCheckIn,
          eligibilityEventId: requireCheckIn ? eligibilityEventId || null : null,
        }),
      });
      if (!res.ok) throw new Error();
      onCreated();
    } catch {
      setError("บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setSaving(false);
    }
  }

  // Matches the modal shell used by admin/clubs, admin/majors, and the
  // scanner result modal: portal (escapes any transformed ancestor that would
  // otherwise clip a `position: fixed` child — see ProposeEventSection.tsx),
  // fade-in, header/body/sticky-footer, all styled off the shared CSS var
  // tokens so it matches the rest of admin instead of a one-off palette.
  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
        padding: "clamp(12px, 4vw, 24px)",
      }}
      onClick={() => !saving && onClose()}
    >
      <div
        className="animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)",
          width: "100%",
          maxWidth: 560,
          maxHeight: "calc(100vh - 48px)",
          display: "flex",
          flexDirection: "column",
          borderRadius: "clamp(20px, 4vw, 28px)",
          overflow: "hidden",
          boxShadow: "0 30px 60px rgba(0,0,0,0.2)",
          border: "1px solid var(--border-medium)",
        }}
      >
        <div style={{ padding: "22px 28px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <h2 style={{ fontSize: 19, fontWeight: 800, color: "var(--text-primary)" }}>สร้างรางวัล</h2>
          <button className="btn btn-ghost" style={{ borderRadius: "50%", width: 36, height: 36, padding: 0 }} onClick={onClose} disabled={saving} aria-label="ปิด">
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 18, overflowY: "auto", flex: 1 }}>
          <div className="field">
            <label className="label">ชื่อรางวัล *</label>
            <input
              className="input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น แก้ว CAMT, รางวัลที่ 1"
              style={{ fontSize: 15, padding: "12px 14px" }}
            />
          </div>

          <div className="field">
            <label className="label">ผูกกับกิจกรรม (ไม่บังคับ)</label>
            <select className="input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">— ไม่ผูก (แจกนอกรอบ) —</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>{e.title}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label">จำนวนที่เตรียมไว้ (ไม่บังคับ)</label>
            <input
              className="input"
              type="number"
              min={0}
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>ใช้เตือนเมื่อแจกเกิน ไม่ได้บล็อกการแจก</p>
          </div>

          <p className="section-title" style={{ margin: "4px 0 -6px" }}>การตั้งค่าการแจก</p>

          <ToggleRow
            checked={onePerStudent}
            onChange={setOnePerStudent}
            title="1 คนรับได้ครั้งเดียว"
            hint="ระบบจะกันรับซ้ำให้ที่ระดับฐานข้อมูล ไม่ว่าจะรับที่งานหรือมารับทีหลัง"
          />

          <ToggleRow
            checked={requireCheckIn}
            onChange={setRequireCheckIn}
            title="ต้องเช็คอินกิจกรรมก่อนถึงมีสิทธิ์รับ"
          />

          {requireCheckIn && (
            <div className="field" style={{ marginLeft: 4, paddingLeft: 14, borderLeft: "2px solid var(--border-subtle)" }}>
              <label className="label">ต้องเช็คอินกิจกรรมไหน</label>
              <select className="input" value={eligibilityEventId} onChange={(e) => setEligibilityEventId(e.target.value)}>
                <option value="">— เลือกกิจกรรม —</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>{e.title}</option>
                ))}
              </select>
              <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                แยกจาก &quot;ผูกกับกิจกรรม&quot; ด้านบน สิทธิ์มาจากกิจกรรมนี้ แต่จะมารับวันไหนที่ไหนก็ได้
              </p>
            </div>
          )}

          {error && <p style={{ color: "#dc2626", fontWeight: 600, fontSize: 13 }}>{error}</p>}
        </div>

        <div style={{ padding: "18px 28px", background: "var(--bg-elevated)", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end", gap: 12, flexShrink: 0 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>ยกเลิก</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving || !name.trim()}>
            {saving ? "กำลังบันทึก…" : "สร้าง"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
        {hint && <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }}>{hint}</span>}
      </span>
    </label>
  );
}
