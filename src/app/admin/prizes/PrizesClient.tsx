"use client";

import { useCallback, useEffect, useState } from "react";
import PrizeAwardPanel from "./PrizeAwardPanel";
import { Gift, Plus, QrCode, FileSpreadsheet, Printer, Loader2, ImageOff, Lock } from "lucide-react";

// /admin/prizes — the top-level prize tab.
//
// It is top-level, not a pane under an event, because a prize is not owned by an
// event: แจกแก้ว is handed out at the event AND at a counter days later, and the
// "one per student" guarantee has to span both. See docs/features/prize-claim.md.

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
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Gift className="h-6 w-6" /> การรับรางวัล
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            บันทึกการแจกของรางวัลพร้อมรูปหลักฐาน — ใช้ได้ทั้งแจกในงานและแจกนอกรอบ
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            <Plus className="h-4 w-4" /> สร้างรางวัล
          </button>
        )}
      </header>

      {!canManage && (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-neutral-100 p-3 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          คุณมีสิทธิ์แจกรางวัลและถ่ายรูปเท่านั้น การสร้างรางวัลและการออกรายงานต้องใช้สิทธิ์ผู้ดูแล
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด…
        </p>
      ) : prizes.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
          ยังไม่มีรางวัล
        </p>
      ) : (
        <ul className="space-y-3">
          {prizes.map((p) => (
            <li key={p.id} className="rounded-xl border p-4 dark:border-neutral-700">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium">{p.name}</h2>
                    {p.status === "closed" && (
                      <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs dark:bg-neutral-700">ปิดรับ</span>
                    )}
                    {p.onePerStudent && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                        1 คน / 1 ชิ้น
                      </span>
                    )}
                    {p.requireCheckIn && (
                      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                        ต้องเช็คอินก่อน
                      </span>
                    )}
                  </div>

                  {canManage && (
                    <p className="mt-1 text-sm text-neutral-500">
                      แจกแล้ว {p.claimCount ?? 0}
                      {p.quantity !== null ? ` / ${p.quantity}` : ""} ชิ้น
                      {/* Over-quantity is a WARNING, never a block: real events
                          over-award, and blocking at the booth makes staff stop
                          recording rather than stop awarding. */}
                      {p.quantity !== null && (p.claimCount ?? 0) > p.quantity && (
                        <span className="ml-2 text-amber-600 dark:text-amber-400">เกินจำนวนที่ตั้งไว้</span>
                      )}
                      {!!p.awaitingPhotoCount && (
                        <span className="ml-2 inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                          <ImageOff className="h-3.5 w-3.5" /> รอรูป {p.awaitingPhotoCount}
                        </span>
                      )}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {canAward && p.status === "open" && (
                    <button
                      onClick={() => setAwarding(p)}
                      className="flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white"
                    >
                      <QrCode className="h-4 w-4" /> แจกรางวัล
                    </button>
                  )}
                  {canExport && (
                    <>
                      <a
                        href={`/api/admin/prizes/${p.id}/export`}
                        className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm dark:border-neutral-700"
                      >
                        <FileSpreadsheet className="h-4 w-4" /> Excel
                      </a>
                      <a
                        href={`/admin/prizes/${p.id}/report`}
                        className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm dark:border-neutral-700"
                      >
                        <Printer className="h-4 w-4" /> PDF
                      </a>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
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
    if (!name.trim()) return;
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
      setError("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">สร้างรางวัล</h2>

        <label className="block text-sm">
          ชื่อรางวัล
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="เช่น แก้ว CAMT, รางวัลที่ 1"
            className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800"
          />
        </label>

        <label className="block text-sm">
          ผูกกับกิจกรรม (ไม่บังคับ)
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800"
          >
            <option value="">— ไม่ผูก (แจกนอกรอบ) —</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>{e.title}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          จำนวนที่เตรียมไว้ (ไม่บังคับ)
          <input
            type="number"
            min={0}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800"
          />
          <span className="mt-1 block text-xs text-neutral-500">
            ใช้เตือนเมื่อแจกเกิน ไม่ได้บล็อกการแจก
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={onePerStudent}
            onChange={(e) => setOnePerStudent(e.target.checked)}
            className="mt-1"
          />
          <span>
            1 คนรับได้ครั้งเดียว
            <span className="mt-0.5 block text-xs text-neutral-500">
              ระบบจะกันรับซ้ำให้ที่ระดับฐานข้อมูล ไม่ว่าจะรับที่งานหรือมารับทีหลัง
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={requireCheckIn}
            onChange={(e) => setRequireCheckIn(e.target.checked)}
            className="mt-1"
          />
          <span>ต้องเช็คอินกิจกรรมก่อนถึงมีสิทธิ์รับ</span>
        </label>

        {requireCheckIn && (
          <label className="block text-sm">
            ต้องเช็คอินกิจกรรมไหน
            <select
              value={eligibilityEventId}
              onChange={(e) => setEligibilityEventId(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800"
            >
              <option value="">— เลือกกิจกรรม —</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>{e.title}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-neutral-500">
              แยกจาก &quot;ผูกกับกิจกรรม&quot; ข้างบน — สิทธิ์มาจากกิจกรรมนี้ แต่จะมารับวันไหนที่ไหนก็ได้
            </span>
          </label>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 rounded-lg border px-4 py-2 text-sm dark:border-neutral-700">
            ยกเลิก
          </button>
          <button
            onClick={submit}
            disabled={saving || !name.trim()}
            className="flex-1 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
          >
            {saving ? "กำลังบันทึก…" : "สร้าง"}
          </button>
        </div>
      </div>
    </div>
  );
}
