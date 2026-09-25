import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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

// This is a SERVER component, so without an explicit zone these format in the
// server's zone — UTC in the Docker container, which printed a 19:25 check-in
// as 12:25. Always pin Asia/Bangkok.
const TZ = "Asia/Bangkok";
const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("th-TH", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const fmtTime = (d: Date | string) =>
  `${new Date(d).toLocaleTimeString("th-TH", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })} น.`;
const fmtDateTime = (d: Date | string | null | undefined) => (d ? `${fmtDate(d)} ${fmtTime(d)}` : "—");

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

  const total = data.rows.length;
  const withoutPhoto = data.rows.filter((r) => !r.photoKey).length;
  const generatedAt = new Date();

  return (
    <div className="prize-report">
      <style>{REPORT_CSS}</style>

      {/* Screen-only toolbar */}
      <div className="pr-toolbar no-print">
        <Link href="/admin/prizes" className="pr-back">
          <ArrowLeft size={16} /> กลับไปหน้ารางวัล
        </Link>
        <p className="pr-hint">
          กด &quot;พิมพ์ / บันทึกเป็น PDF&quot; แล้วเลือกปลายทางเป็น <b>Save as PDF</b> — ไฟล์นี้คือหลักฐานตัวจริง (รูปผูกกับชื่อถาวร)
        </p>
        <PrintButton />
      </div>

      {/* The paper */}
      <article className="pr-paper">
        <header className="pr-head">
          <div className="pr-brandrow">
            <div className="pr-brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/smocamt-logo-icon.png" alt="" />
              <div>
                <p className="pr-eyebrow">ActiveCAMT · SMO CAMT</p>
                <h1>รายงานการรับรางวัล</h1>
              </div>
            </div>
            <div className="pr-generated">
              <p>ออกรายงานเมื่อ</p>
              <p><b>{fmtDateTime(generatedAt)}</b></p>
            </div>
          </div>

          <h2 className="pr-prize">{data.prize.name}</h2>
          <dl className="pr-meta">
            {data.contextEvent && (
              <>
                <dt>กิจกรรม</dt>
                <dd><b>{data.contextEvent.title}</b></dd>
                {data.contextEvent.startTime && (
                  <>
                    <dt>วันที่จัดกิจกรรม</dt>
                    <dd>{fmtDateTime(data.contextEvent.startTime)}</dd>
                  </>
                )}
              </>
            )}
            <dt>รหัสอ้างอิง</dt>
            <dd className="pr-mono pr-muted">{id}</dd>
          </dl>

          <div className="pr-stats">
            <div className="pr-stat">
              <p className="pr-stat-num">{total}</p>
              <p>ผู้รับทั้งหมด (คน)</p>
            </div>
            <div className="pr-stat">
              <p className="pr-stat-num">{total - withoutPhoto}</p>
              <p>มีรูปหลักฐาน</p>
            </div>
            <div className={`pr-stat${withoutPhoto > 0 ? " pr-stat-warn" : ""}`}>
              <p className="pr-stat-num">{withoutPhoto}</p>
              <p>ยังไม่มีรูปหลักฐาน</p>
            </div>
          </div>
        </header>

        {total === 0 ? (
          <p className="pr-empty">ยังไม่มีผู้รับรางวัล</p>
        ) : (
          <table className="pr-table">
            <thead>
              <tr>
                <th className="pr-col-num">#</th>
                <th>ผู้รับรางวัล</th>
                <th className="pr-wide">เข้าร่วมกิจกรรม</th>
                <th className="pr-wide">รับรางวัล</th>
                <th className="pr-col-photo">รูปหลักฐาน</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => {
                // The student's own first check-in, else the event's date, else blank.
                const attendedAt = row.attendedAt ?? data.contextEvent?.startTime ?? null;
                const attended = (
                  <>
                    {attendedAt ? (
                      <>
                        <p>{fmtDate(attendedAt)}</p>
                        <p className="pr-muted">{fmtTime(attendedAt)}</p>
                      </>
                    ) : (
                      <p className="pr-faint">—</p>
                    )}
                    {row.daysAttended ? <p className="pr-muted">รวม {row.daysAttended} วัน</p> : null}
                  </>
                );
                const claimed = (
                  <>
                    <p>{fmtDate(row.claimedAt)}</p>
                    <p className="pr-muted">{fmtTime(row.claimedAt)}</p>
                    <p className="pr-muted pr-gap">ผู้แจก: <span className="pr-ink">{row.awardedByName ?? "—"}</span></p>
                  </>
                );
                return (
                  <tr key={row.claimId} className="claim-row">
                    <td className="pr-col-num pr-muted">{i + 1}</td>
                    <td>
                      <p className="pr-name">{row.name}</p>
                      <p className="pr-muted">รหัสนักศึกษา <span className="pr-mono pr-ink">{row.studentId ?? "—"}</span></p>
                      {row.prizeName !== data.prize.name && <p className="pr-muted">รางวัล: <span className="pr-ink">{row.prizeName}</span></p>}
                      {row.note && <p className="pr-note">หมายเหตุ: {row.note}</p>}
                      {/* Narrow screens: the two date columns collapse into here. */}
                      <div className="pr-narrow">
                        <div><p className="pr-label">เข้าร่วม</p>{attended}</div>
                        <div><p className="pr-label">รับรางวัล</p>{claimed}</div>
                      </div>
                    </td>
                    <td className="pr-wide">{attended}</td>
                    <td className="pr-wide">{claimed}</td>
                    <td className="pr-col-photo">
                      {row.photoKey ? (
                        // Loaded through the SAME auth-guarded claim-photo route as
                        // everywhere else, so this page cannot render for anyone not
                        // already authorised and each fetch is audit-logged.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/admin/prizes/claims/${row.claimId}/photo`}
                          alt={`หลักฐานการรับรางวัลของ ${row.name}`}
                          className="claim-photo pr-photo"
                        />
                      ) : (
                        // Never silently omit a winner who has no photo — the gap has
                        // to be visible to whoever signs this off.
                        <div className="pr-photo pr-nophoto">ไม่มีรูปหลักฐาน</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <footer className="sign-off">
          {["ผู้จัดทำรายงาน", "ผู้รับรอง"].map((role) => (
            <div key={role}>
              <p>ลงชื่อ ....................................................</p>
              <p>( .................................................... )</p>
              <p><b>{role}</b></p>
              <p>วันที่ ........ / ........ / ............</p>
            </div>
          ))}
        </footer>
      </article>
    </div>
  );
}

// Plain scoped CSS rather than Tailwind spacing utilities: globals.css has an
// UNLAYERED `* { margin: 0; padding: 0 }` reset, which beats Tailwind v4's
// layered p-*/m-* utilities, so they silently do nothing here.
const REPORT_CSS = `
.prize-report { background: #e5e5e5; margin: -8px -16px -32px; padding: 16px 16px 40px; min-height: 100%; color: #171717; }
@media (min-width: 640px) { .prize-report { margin: -8px -24px -32px; padding: 20px 24px 48px; } }
.prize-report p { margin: 0; }
.pr-toolbar { max-width: 210mm; margin: 0 auto 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.pr-back { display: inline-flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 8px; font-size: 14px; font-weight: 600; color: #404040; text-decoration: none; }
.pr-back:hover { background: rgba(0,0,0,0.06); }
.pr-hint { flex: 1; min-width: 14rem; font-size: 13px; color: #525252; line-height: 1.5; }
.pr-paper { max-width: 210mm; margin: 0 auto; background: #fff; padding: 20px; box-shadow: 0 8px 30px rgba(0,0,0,0.12); border-radius: 4px; font-size: 13px; line-height: 1.55; }
@media (min-width: 640px) { .pr-paper { padding: 14mm 12mm; } }
.pr-head { border-bottom: 2px solid #171717; padding-bottom: 16px; }
.pr-brandrow { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.pr-brand { display: flex; align-items: center; gap: 12px; }
.pr-brand img { width: 44px; height: 44px; object-fit: contain; }
.pr-eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #737373; }
.pr-brand h1 { font-size: 22px; font-weight: 800; line-height: 1.2; margin: 0; }
.pr-generated { text-align: right; font-size: 11px; color: #737373; }
.pr-generated b { color: #262626; font-weight: 600; }
.pr-prize { font-size: 19px; font-weight: 800; line-height: 1.3; margin: 18px 0 6px; }
.pr-meta { display: grid; grid-template-columns: auto 1fr; gap: 2px 16px; margin: 0; }
.pr-meta dt { color: #737373; }
.pr-meta dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.pr-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; }
.pr-stat { border: 1px solid #d4d4d4; border-radius: 6px; padding: 8px; text-align: center; font-size: 11px; color: #525252; }
.pr-stat-num { font-size: 22px; font-weight: 800; line-height: 1.1; color: #171717; }
.pr-stat-warn { border-color: #f87171; background: #fef2f2; color: #991b1b; }
.pr-stat-warn .pr-stat-num { color: #991b1b; }
.pr-empty { padding: 64px 0; text-align: center; color: #737373; }
.pr-table { width: 100%; border-collapse: collapse; margin-top: 18px; text-align: left; }
.pr-table th { padding: 8px 12px 8px 0; border-bottom: 1.5px solid #171717; font-size: 11px; font-weight: 700; color: #525252; vertical-align: bottom; }
.pr-table td { padding: 12px 12px 12px 0; border-bottom: 1px solid #d4d4d4; vertical-align: top; }
.pr-table th:last-child, .pr-table td:last-child { padding-right: 0; }
.pr-col-num { width: 28px; }
.pr-col-photo { width: 32mm; text-align: center; }
.pr-name { font-weight: 700; font-size: 14px; line-height: 1.35; }
.pr-muted { color: #595959; }
.pr-faint { color: #a3a3a3; }
.pr-ink { color: #171717; }
.pr-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.95em; }
.pr-gap { margin-top: 4px !important; }
.pr-note { margin-top: 6px !important; padding: 3px 8px; background: #f5f5f5; border-left: 3px solid #a3a3a3; border-radius: 2px; color: #404040; }
.pr-label { font-weight: 700; color: #737373; font-size: 11px; }
.pr-narrow { display: none; }
.pr-photo { display: block; width: 30mm; height: 30mm; margin: 0 auto; border-radius: 4px; border: 1px solid #d4d4d4; object-fit: cover; }
.pr-nophoto { display: flex; align-items: center; justify-content: center; border: 2px dashed #fca5a5; background: #fef2f2; color: #b91c1c; font-size: 11px; font-weight: 600; text-align: center; padding: 4px; }
.sign-off { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 48px; text-align: center; }
.sign-off p + p { margin-top: 10px; }
@media screen and (max-width: 639px) {
  .pr-wide { display: none; }
  .pr-narrow { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; font-size: 12px; }
  .pr-col-photo { width: 24mm; }
  .pr-photo { width: 22mm; height: 22mm; }
  .pr-brandrow { flex-direction: column; }
  .pr-generated { text-align: left; }
  .sign-off { grid-template-columns: 1fr; }
}

@page {
  size: A4 portrait;
  margin: 12mm 12mm 16mm;
  @bottom-center { content: "หน้า " counter(page) " / " counter(pages); font-size: 9pt; color: #525252; }
}
@media print {
  /* The admin shell is a fixed-height (h-dvh) overflow-hidden flex box whose
     <main> scrolls — printed as-is, only the visible screenful makes it onto
     paper. Flatten it back into normal document flow and drop the chrome so
     the saved PDF is just the report, every page of it. */
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body:has(.prize-report) header:not(.pr-head),
  body:has(.prize-report) aside,
  body:has(.prize-report) nav,
  .no-print { display: none !important; }
  body:has(.prize-report) div:has(> main),
  body:has(.prize-report) main {
    display: block !important; height: auto !important; overflow: visible !important;
    padding: 0 !important; background: #fff !important;
  }
  .prize-report { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .pr-paper { max-width: none; padding: 0; box-shadow: none; border-radius: 0; font-size: 10.5pt; }
  /* Never split a student's row across two pages — a name on one page and
     their proof photo on the next is exactly the ambiguity this document
     exists to remove. The header row repeats on each page. */
  .claim-row, .sign-off { break-inside: avoid; page-break-inside: avoid; }
  thead { display: table-header-group; }
}
`;
