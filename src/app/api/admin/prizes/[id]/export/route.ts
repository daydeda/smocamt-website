import ExcelJS from "exceljs";
import sharp from "sharp";
import { PrizeService } from "@/modules/events/prize.service";
import { AuditService } from "@/modules/audit/audit.service";
import { canReachPrize, resolvePrizeAccess } from "@/lib/prize-scope";
import { downloadFormFile } from "@/lib/form-file-storage";
import { getClientIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { captureException } from "@/lib/logger";

// GET /api/admin/prizes/[id]/export — the dean report as an EDITABLE .xlsx with
// the proof photos embedded.
//
// NOTE ON THE LIBRARY: this route uses `exceljs`, while every other export in
// the repo uses `xlsx`. That is deliberate, not an accident. The SheetJS
// community build this repo pins cannot embed images (that is a SheetJS Pro
// feature), and the faculty needs the photos beside the names. Scoped to this
// one route on purpose — do not migrate the other exports on the strength of it.
//
// The PDF sibling (/admin/prizes/[id]/report, a print-styled page) reads the
// SAME PrizeService query, so the two artefacts cannot disagree. The split
// exists because a picture in .xlsx is a floating object anchored over cells:
// sorting the sheet moves the rows and NOT the images, which silently puts
// every photo beside the wrong student. The PDF is therefore the authoritative
// record and the sheet says so in its own header note.

export const runtime = "nodejs";
// Downloading + resizing one photo per winner is slower than a plain sheet.
export const maxDuration = 120;

// Longest edge for the embedded thumbnail. A 5MB phone photo per row would
// produce a file Excel refuses to open; at this size a row costs ~25-40KB.
const THUMB_PX = 320;
const PHOTO_COL_WIDTH = 24;  // ≈ 170px
const PHOTO_ROW_HEIGHT = 130;

// Guard against someone generating a report for a giveaway with thousands of
// claims: every photo is fetched and resized in memory.
const MAX_ROWS = 1000;

// Guards the id before it reaches a query. A missing/malformed id passed
// straight into a lookup is sent to Postgres as a bound parameter, which
// fails as an opaque driver-level error instead of a clean 400.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await resolvePrizeAccess();
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Narrower than awarding on purpose: this is every winner's name,
    // รหัสนักศึกษา and face photo in one forwardable file. smo cannot pull it.
    if (!access.canExport) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    if (!id || !UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: "Invalid prize id" }, { status: 400 });
    }
    const data = await PrizeService.getClaimsForReport(id);
    if (!data) return NextResponse.json({ error: "Prize not found" }, { status: 404 });
    if (!(await canReachPrize(access, data.prize))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (data.rows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `This prize has ${data.rows.length} claims; the photo report is capped at ${MAX_ROWS}. Use the print page or narrow the range.` },
        { status: 413 },
      );
    }

    const wb = new ExcelJS.Workbook();
    wb.created = new Date();
    const ws = wb.addWorksheet("รายชื่อผู้รับรางวัล");

    // Two note rows above the table. The second is not decoration: it tells the
    // reader which artefact is authoritative once they start sorting.
    ws.mergeCells("A1:I1");
    ws.getCell("A1").value = `รายงานการรับรางวัล: ${data.prize.name}`
      + (data.contextEvent ? ` — ${data.contextEvent.title}` : "");
    ws.getCell("A1").font = { bold: true, size: 14 };

    ws.mergeCells("A2:I2");
    ws.getCell("A2").value = "หมายเหตุ: รูปถ่ายจะไม่เลื่อนตามเมื่อ sort/filter ตาราง — ให้ยึดไฟล์ PDF เป็นหลักฐาน";
    ws.getCell("A2").font = { italic: true, color: { argb: "FFB00020" } };

    const header = ["ลำดับ", "ชื่อ–นามสกุล", "รหัสนักศึกษา", "รางวัล", "วันที่เข้าร่วมกิจกรรม", "จำนวนวันที่เข้าร่วม", "วันที่ได้รับของ", "ผู้แจก", "รูปถ่าย", "หมายเหตุ"];
    const headerRow = ws.addRow(header);
    headerRow.font = { bold: true };
    headerRow.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    });

    ws.columns = [
      { width: 7 }, { width: 28 }, { width: 14 }, { width: 22 },
      { width: 20 }, { width: 10 }, { width: 20 }, { width: 20 },
      { width: PHOTO_COL_WIDTH }, { width: 28 },
    ];
    ws.views = [{ state: "frozen", ySplit: headerRow.number }];
    ws.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: header.length } };

    const DATE_FMT = "dd/mm/yyyy hh:mm";

    for (const [i, row] of data.rows.entries()) {
      // Fall back to the event's own start time when the student has no
      // check-in of their own (e.g. a standing giveaway, or a winner who was
      // never on the attendance roster).
      const attendedAt = row.attendedAt ?? data.contextEvent?.startTime ?? null;

      const excelRow = ws.addRow([
        i + 1,
        row.name,
        row.studentId ?? "",
        row.prizeName,
        // Real Date values, not preformatted strings: a text date sorts
        // alphabetically, which makes an "editable" report useless the first
        // time someone sorts by it.
        attendedAt ? new Date(attendedAt) : "",
        row.daysAttended || "",
        new Date(row.claimedAt),
        row.awardedByName ?? "",
        row.photoKey ? "" : "— ไม่มีรูป —",
        row.note ?? "",
      ]);
      excelRow.height = PHOTO_ROW_HEIGHT;
      excelRow.getCell(5).numFmt = DATE_FMT;
      excelRow.getCell(7).numFmt = DATE_FMT;
      excelRow.getCell(9).alignment = { vertical: "middle", horizontal: "center" };

      if (!row.photoKey) continue;

      try {
        const { buffer } = await downloadFormFile(row.photoKey);
        const thumb = await sharp(buffer)
          .rotate() // honour EXIF orientation — phone photos are routinely sideways
          .resize(THUMB_PX, THUMB_PX, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 78 })
          .toBuffer();
        const meta = await sharp(thumb).metadata();

        const imageId = wb.addImage({ buffer: new Uint8Array(thumb) as unknown as ExcelJS.Buffer, extension: "jpeg" });
        // Fit inside the cell while keeping the aspect ratio, so portrait and
        // landscape photos both sit in the row without stretching.
        const scale = Math.min(150 / (meta.width ?? 1), (PHOTO_ROW_HEIGHT - 8) / (meta.height ?? 1));
        ws.addImage(imageId, {
          tl: { col: 8.1, row: excelRow.number - 1 + 0.05 },
          ext: { width: Math.round((meta.width ?? 1) * scale), height: Math.round((meta.height ?? 1) * scale) },
        });
      } catch (e) {
        // One unreadable object must not fail the whole report — mark that row
        // so the gap is visible instead of looking like a claim with no photo.
        console.error(`Failed to embed prize photo for claim ${row.claimId}:`, e);
        excelRow.getCell(9).value = "— โหลดรูปไม่สำเร็จ —";
      }
    }

    // PDPA: this file is the loosest artefact the feature produces — names,
    // รหัสนักศึกษา and faces in one document designed to be forwarded. Logged as
    // an EXPORT, not a view, and not best-effort: if we can't record who took
    // the whole roster, we don't hand it over.
    await AuditService.logAction({
      actorId: access.userId,
      action: `Exported prize report xlsx "${data.prize.name}" (${id}, ${data.rows.length} claims, with photos)`,
      ipAddress: getClientIp(req),
    });

    const out = await wb.xlsx.writeBuffer();
    const filename = `prize-${data.prize.name.replace(/[^\p{L}\p{N}_-]+/gu, "_")}-${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(new Uint8Array(out as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    captureException(e, { route: "GET /api/admin/prizes/[id]/export" });
    return NextResponse.json({ error: "Failed to generate the report" }, { status: 500 });
  }
}
