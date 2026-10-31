"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Download, Loader2 } from "lucide-react";
import { PageHeader, Panel, Field, InlineAlert, useToast } from "@/components/admin/ui";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { buildTagSheetPdf } from "@/lib/property-tags/property-tag-pdf";
import {
  formatTagLabel,
  labelGridForPerPage,
  MAX_TAGS_PER_PAGE,
  MIN_RECOMMENDED_QR_MM,
  tagUrl,
} from "@/lib/property-tags/property-tag";

interface PrintTag {
  code: string;
  series: string;
  serial: number;
  empty: boolean;
}

const PER_PAGE_PRESETS = [6, 12, 24, 35, 40, 63];

// The origin is baked into every printed QR, so it has to be read in the
// browser (the page the staff member is actually on). useSyncExternalStore
// keeps the server render and first client render identical.
const subscribeNoop = () => () => {};
const useOrigin = () => useSyncExternalStore(subscribeNoop, () => window.location.origin, () => "");

function looksLocal(origin: string) {
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol !== "https:" || hostname === "localhost" || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
  } catch {
    return true;
  }
}

export default function PrintSheet({ groupId, groupName, tags }: { groupId: string; groupName: string; tags: PrintTag[] }) {
  const { t } = useLanguage();
  const toast = useToast();
  const origin = useOrigin();
  const [perPage, setPerPage] = useState(24);
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [series, setSeries] = useState<string>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [building, setBuilding] = useState(false);
  const [pdfError, setPdfError] = useState(false);

  const seriesList = useMemo(() => [...new Set(tags.map((tg) => tg.series))], [tags]);
  const grid = labelGridForPerPage(perPage);
  const slots = grid.cols * grid.rows;

  const selected = useMemo(() => {
    const lo = from ? Number(from) : -Infinity;
    const hi = to ? Number(to) : Infinity;
    return tags.filter((tg) =>
      (!onlyEmpty || tg.empty) &&
      (!series || tg.series === series) &&
      tg.serial >= lo &&
      tg.serial <= hi,
    );
  }, [tags, onlyEmpty, series, from, to]);

  const pages = useMemo(() => {
    const out: PrintTag[][] = [];
    for (let i = 0; i < selected.length; i += slots) out.push(selected.slice(i, i + slots));
    return out;
  }, [selected, slots]);

  // Exact-size PDF: the browser's own print layout rescales and re-margins the
  // page (and adds a header/footer), so cut-out stickers could drift.
  async function downloadPdf() {
    setBuilding(true);
    setPdfError(false);
    try {
      const blob = await buildTagSheetPdf({ tags: selected, origin, grid, logoUrl: "/smocamt-logo-icon.png" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${groupName.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "property-tags"}-tags.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(t.adminPtUiPdfReady);
    } catch {
      setPdfError(true);
    } finally {
      setBuilding(false);
    }
  }

  const qr = grid.qrMm;
  const tooSmall = qr < MIN_RECOMMENDED_QR_MM;

  return (
    <div className="pt-print">
      <style>{PRINT_CSS}</style>

      <div className="pt-toolbar no-print">
        <PageHeader
          back={{ href: `/admin/property-tags/${groupId}`, label: groupName }}
          title={t.adminPtPrintTitle}
          description={t.adminPtPrintHint}
          actions={
            <button className="btn btn-primary" onClick={() => void downloadPdf()} disabled={selected.length === 0 || !origin || building}>
              {building ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Download size={18} aria-hidden="true" />} {building ? t.adminPtPdfBuilding : t.adminPtDownloadPdf}
            </button>
          }
        />

        <Panel title={t.adminPtUiWhichTags}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="pt-controls">
              <Field label={t.adminPtPerPage}>
                {(p) => (
                  <>
                    <input
                      {...p}
                      className="input"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_TAGS_PER_PAGE}
                      value={perPage}
                      list="pt-per-page-presets"
                      onChange={(e) => setPerPage(Math.max(1, Math.min(MAX_TAGS_PER_PAGE, Number(e.target.value) || 1)))}
                    />
                    <datalist id="pt-per-page-presets">
                      {PER_PAGE_PRESETS.map((n) => <option key={n} value={n} />)}
                    </datalist>
                  </>
                )}
              </Field>
              {seriesList.length > 1 && (
                <Field label={t.adminPtSeries}>
                  {(p) => (
                    <select {...p} className="input" value={series} onChange={(e) => setSeries(e.target.value)}>
                      <option value="">{t.adminPtPrintSeriesAll}</option>
                      {seriesList.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </Field>
              )}
              <Field label={t.adminPtRangeFrom}>
                {(p) => <input {...p} className="input" type="number" inputMode="numeric" min={1} value={from} onChange={(e) => setFrom(e.target.value)} />}
              </Field>
              <Field label={t.adminPtRangeTo}>
                {(p) => <input {...p} className="input" type="number" inputMode="numeric" min={1} value={to} onChange={(e) => setTo(e.target.value)} />}
              </Field>
            </div>

            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, fontSize: 14, color: "var(--text-secondary)", cursor: "pointer" }}>
              <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} style={{ width: 18, height: 18 }} />
              {t.adminPtPrintOnlyEmpty}
            </label>
          </div>
        </Panel>

        <p role="status" style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.6, color: "var(--text-primary)" }}>
          {t.adminPtPrintSummary
            .replace("{count}", String(selected.length))
            .replace("{pages}", String(pages.length))
            .replace("{cols}", String(grid.cols))
            .replace("{rows}", String(grid.rows))
            .replace("{size}", qr.toFixed(0))}
        </p>
        {tooSmall && <InlineAlert tone="warning">{t.adminPtPrintSmallWarning}</InlineAlert>}
        {origin && looksLocal(origin) && <InlineAlert tone="warning">{t.adminPtPrintOriginWarning.replace("{origin}", origin)}</InlineAlert>}
        {pdfError && <InlineAlert tone="error">{t.adminPtPdfError}</InlineAlert>}
        {selected.length === 0 && <InlineAlert tone="info">{t.adminPtNoMatch}</InlineAlert>}
      </div>

      {origin && (
        <div className="pt-pages">
          {pages.map((page, pi) => (
            <section
              key={pi}
              className="pt-page"
              style={{ gridTemplateColumns: `repeat(${grid.cols}, 1fr)`, gridTemplateRows: `repeat(${grid.rows}, 1fr)` }}
            >
              {page.map((tg) => (
                <div key={tg.code} className="pt-label">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/smocamt-logo-icon.png" alt="" style={{ height: `${qr * 0.3}mm` }} />
                  <QRCodeSVG
                    value={tagUrl(origin, tg.code)}
                    level="M"
                    marginSize={2}
                    size={256}
                    style={{ width: `${qr}mm`, height: `${qr}mm` }}
                  />
                  <span className="pt-serial" style={{ fontSize: `${Math.max(6, qr * 0.42)}pt` }}>{formatTagLabel(tg.series, tg.serial)}</span>
                  <span className="pt-code" style={{ fontSize: `${Math.max(5, qr * 0.26)}pt` }}>{tg.code}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// Sizes are real millimetres so the on-screen preview matches the PDF. Colours are literal black/white on purpose: the sheet
// is paper, and must not follow the app's dark theme.
const PRINT_CSS = `
.pt-toolbar { display: flex; flex-direction: column; gap: 14px; max-width: 720px; margin-bottom: 24px; }
.pt-controls { display: flex; flex-wrap: wrap; gap: 12px; }
.pt-controls .field { flex: 1 1 120px; max-width: 180px; }
.pt-pages { display: flex; flex-direction: column; gap: 16px; overflow-x: auto; padding-bottom: 8px; }
.pt-page {
  display: grid; width: 190mm; height: 277mm; flex-shrink: 0; box-sizing: border-box;
  background: #fff; color: #000; box-shadow: 0 4px 20px rgb(0 0 0 / 0.12);
}
.pt-label {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.6mm;
  border: 0.2mm dashed #9a9a9a; overflow: hidden; min-width: 0; min-height: 0; box-sizing: border-box;
}
.pt-label img { width: auto; display: block; }
.pt-label svg { display: block; }
.pt-serial { font-weight: 800; letter-spacing: 0.02em; line-height: 1.1; }
.pt-code { font-family: ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: 0.08em; line-height: 1.1; color: #333; }
`;
