import { notFound, redirect } from "next/navigation";
import { PrizeService } from "@/modules/events/prize.service";
import { AuditService } from "@/modules/audit/audit.service";
import { canReachPrize, resolvePrizeAccess } from "@/lib/prize-scope";
import { headers } from "next/headers";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

// The dean report, PDF side: a print-styled page the staff saves with ⌘P.
//
// The .xlsx sibling (/api/admin/prizes/[id]/export) reads the SAME
// PrizeService.getClaimsForReport query, so the two artefacts cannot disagree.
// This one exists because a picture inside an .xlsx is a floating object
// anchored OVER cells — sorting the sheet reorders the rows and NOT the images,
// silently pairing every photo with the wrong student. Here the photo sits in
// the document flow next to its own name and cannot drift, which is what makes
// this the authoritative record. See docs/features/prize-claim.md.
//
// No PDF library: the browser renders it. A useful side effect is that Thai
// rendering (สระ/วรรณยุกต์ stacking, word-break) is the browser's problem rather
// than ours — it is a well-known source of broken output in server-side PDF
// libraries.

const fmt = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "—";

// Guards the id before it reaches a query, matching the .xlsx sibling. A
// missing/malformed id passed straight into a lookup is sent to Postgres as a
// bound parameter, which fails as an opaque driver-level error instead of a
// clean 404.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PrizeReportPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await resolvePrizeAccess();
  // Same gate as the .xlsx: awarding is one student at a time in person, but
  // this page is the whole roster of names, รหัสนักศึกษา and faces on one screen.
  if (!access?.canExport) redirect("/admin/dashboard");

  const { id } = await params;
  if (!id || !UUID_PATTERN.test(id)) notFound();
  const data = await PrizeService.getClaimsForReport(id);
  if (!data) notFound();
  if (!(await canReachPrize(access, data.prize))) redirect("/admin/dashboard");

  // Logged as an EXPORT, not a view — opening this is taking the whole roster,
  // the same act as downloading the spreadsheet.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  await AuditService.logAction({
    actorId: access.userId,
    action: `Opened prize report page "${data.prize.name}" (${id}, ${data.rows.length} claims)`,
    ipAddress: ip,
  });

  const withoutPhoto = data.rows.filter((r) => !r.photoKey).length;

  return (
    <div className="mx-auto max-w-4xl bg-white p-6 text-black print:p-0">
      <style>{`
        @media print {
          /* Hide the app chrome so the saved PDF is just the report. */
          nav, header[data-admin-header], aside, .no-print { display: none !important; }
          /* Never split a student's row across two pages — a name on one page
             and their proof photo on the next is exactly the ambiguity this
             document exists to remove. */
          .claim-row { break-inside: avoid; page-break-inside: avoid; }
          @page { margin: 14mm; }
        }
      `}</style>

      <div className="no-print mb-4 flex items-center justify-between gap-3 rounded-lg bg-neutral-100 p-3">
        <p className="text-sm text-neutral-700">
          กด Print แล้วเลือก &quot;Save as PDF&quot; — ไฟล์นี้คือหลักฐานตัวจริง (รูปผูกกับชื่อถาวร)
        </p>
        <PrintButton />
      </div>

      <header className="mb-6 border-b-2 border-black pb-4">
        <h1 className="text-2xl font-bold">รายงานการรับรางวัล</h1>
        <p className="mt-1 text-lg">{data.prize.name}</p>
        {data.contextEvent && (
          <p className="text-sm">
            กิจกรรม: {data.contextEvent.title}
            {data.contextEvent.startTime ? ` · ${fmt(data.contextEvent.startTime)}` : ""}
          </p>
        )}
        <p className="mt-2 text-sm">
          จำนวนผู้รับทั้งหมด {data.rows.length} คน
          {withoutPhoto > 0 && <span> · ยังไม่มีรูปหลักฐาน {withoutPhoto} คน</span>}
        </p>
        <p className="text-xs text-neutral-600">ออกรายงานเมื่อ {fmt(new Date())}</p>
      </header>

      {data.rows.length === 0 ? (
        <p className="py-10 text-center text-neutral-600">ยังไม่มีผู้รับรางวัล</p>
      ) : (
        <ol className="space-y-4">
          {data.rows.map((row, i) => {
            // The student's own first check-in, else the event's date, else blank.
            const attendedAt = row.attendedAt ?? data.contextEvent?.startTime ?? null;
            return (
              <li key={row.claimId} className="claim-row flex gap-4 border-b border-neutral-300 pb-4">
                <div className="w-8 shrink-0 pt-1 text-sm font-medium">{i + 1}.</div>

                <div className="min-w-0 flex-1 text-sm">
                  <p className="text-base font-semibold">{row.name}</p>
                  <p>รหัสนักศึกษา: {row.studentId ?? "—"}</p>
                  <p>รางวัล: {row.prizeName}</p>
                  <p>
                    วันที่เข้าร่วมกิจกรรม: {fmt(attendedAt)}
                    {row.daysAttended ? ` (${row.daysAttended} วัน)` : ""}
                  </p>
                  <p>วันที่ได้รับของ: {fmt(row.claimedAt)}</p>
                  <p>ผู้แจก: {row.awardedByName ?? "—"}</p>
                  {row.note && <p>หมายเหตุ: {row.note}</p>}
                </div>

                <div className="w-40 shrink-0">
                  {row.photoKey ? (
                    // Loaded through the SAME auth-guarded claim-photo route as
                    // everywhere else, so this page cannot render for anyone not
                    // already authorised and each fetch is audit-logged.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/admin/prizes/claims/${row.claimId}/photo`}
                      alt={`หลักฐานการรับรางวัลของ ${row.name}`}
                      className="h-40 w-40 rounded border border-neutral-300 object-cover"
                    />
                  ) : (
                    // Never silently omit a winner who has no photo — the gap has
                    // to be visible to whoever signs this off.
                    <div className="flex h-40 w-40 items-center justify-center rounded border border-dashed border-neutral-400 text-center text-xs text-neutral-500">
                      — ไม่มีรูปหลักฐาน —
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <footer className="mt-10 flex justify-end gap-16 text-sm">
        <div className="text-center">
          <div className="mb-1 h-16" />
          <div className="w-56 border-t border-black pt-1">ผู้จัดทำรายงาน</div>
        </div>
        <div className="text-center">
          <div className="mb-1 h-16" />
          <div className="w-56 border-t border-black pt-1">ผู้รับรอง</div>
        </div>
      </footer>
    </div>
  );
}
