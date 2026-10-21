import { formatTagLabel, tagUrl, type LabelGrid } from "@/lib/property-tags/property-tag";

// Builds the print sheet as a real A4 PDF instead of leaning on the browser's
// print dialog. Safari and Chrome both rescale or re-margin a printed web page
// (and add their own header/footer), so a sheet of cut-out stickers drifted
// from what the preview showed. Here every size is an exact millimetre, and the
// QR is drawn as vector squares so it stays sharp at any size.
//
// Geometry mirrors PrintSheet's on-screen preview: 10 mm page margin, one grid
// cell per tag, dashed cut lines, and a centred stack of logo, QR, serial and
// short code.

export interface PdfTag {
  code: string;
  series: string;
  serial: number;
}

const MARGIN_MM = 10;
const GAP_MM = 0.6;
const PT_TO_MM = 25.4 / 72;
const QUIET_MODULES = 2;

export async function buildTagSheetPdf(params: {
  tags: PdfTag[];
  origin: string;
  grid: LabelGrid;
  /** Same-origin URL of the logo, e.g. /smocamt-logo-icon.png. */
  logoUrl: string;
}): Promise<Blob> {
  const { tags, origin, grid, logoUrl } = params;
  const [{ jsPDF }, QRCode, logo] = await Promise.all([
    import("jspdf"),
    import("qrcode"),
    loadLogo(logoUrl),
  ]);

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const slots = grid.cols * grid.rows;
  const qr = grid.qrMm;
  const logoH = qr * 0.3;
  const logoW = logo ? (logoH * logo.width) / logo.height : 0;
  const serialPt = Math.max(6, qr * 0.42);
  const codePt = Math.max(5, qr * 0.26);
  const serialH = serialPt * PT_TO_MM * 1.1;
  const codeH = codePt * PT_TO_MM * 1.1;
  const stackH = logoH + GAP_MM + qr + GAP_MM + serialH + GAP_MM + codeH;

  tags.forEach((tag, i) => {
    if (i > 0 && i % slots === 0) doc.addPage();
    const slot = i % slots;
    const col = slot % grid.cols;
    const row = Math.floor(slot / grid.cols);
    const x0 = MARGIN_MM + col * grid.cellWidthMm;
    const y0 = MARGIN_MM + row * grid.cellHeightMm;
    const cx = x0 + grid.cellWidthMm / 2;

    // Dashed cut line around the cell.
    doc.setDrawColor(154, 154, 154);
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([0.8, 0.8], 0);
    doc.rect(x0, y0, grid.cellWidthMm, grid.cellHeightMm, "S");
    doc.setLineDashPattern([], 0);

    let y = y0 + (grid.cellHeightMm - stackH) / 2;
    if (logo) doc.addImage(logo.dataUrl, "PNG", cx - logoW / 2, y, logoW, logoH);
    y += logoH + GAP_MM;

    drawQr(doc, QRCode, tagUrl(origin, tag.code), cx - qr / 2, y, qr);
    y += qr + GAP_MM;

    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(serialPt);
    doc.text(formatTagLabel(tag.series, tag.serial), cx, y + serialH * 0.82, { align: "center" });
    y += serialH + GAP_MM;

    doc.setTextColor(51, 51, 51);
    doc.setFont("courier", "normal");
    doc.setFontSize(codePt);
    doc.text(tag.code, cx, y + codeH * 0.82, { align: "center", charSpace: codePt * PT_TO_MM * 0.08 });
  });

  return doc.output("blob");
}

// Dark modules as vector squares; horizontal runs are merged into one rect so
// a 1000-tag sheet stays a few MB instead of tens.
function drawQr(
  doc: import("jspdf").jsPDF,
  QRCode: typeof import("qrcode"),
  value: string,
  x: number,
  y: number,
  size: number,
) {
  const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
  const n = modules.size;
  const cell = size / (n + QUIET_MODULES * 2);
  doc.setFillColor(0, 0, 0);
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!modules.get(r, c)) {
        c++;
        continue;
      }
      let end = c;
      while (end + 1 < n && modules.get(r, end + 1)) end++;
      doc.rect(x + (c + QUIET_MODULES) * cell, y + (r + QUIET_MODULES) * cell, (end - c + 1) * cell, cell, "F");
      c = end + 1;
    }
  }
}

async function loadLogo(url: string): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const blob = await (await fetch(url)).blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = dataUrl;
    });
    return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    // The sheet is still usable without the logo.
    return null;
  }
}
