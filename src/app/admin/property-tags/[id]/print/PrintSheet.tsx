"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, ArrowLeft, Printer } from "lucide-react";
import { useLanguage } from "@/lib/LanguageContext";
import {
  formatTagLabel,
  labelGridForPerPage,
  MAX_TAGS_PER_PAGE,
  MIN_RECOMMENDED_QR_MM,
  tagUrl,
} from "@/lib/property-tag";

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
  const origin = useOrigin();
  const [perPage, setPerPage] = useState(24);
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [series, setSeries] = useState<string>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

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

  const qr = grid.qrMm;
  const tooSmall = qr < MIN_RECOMMENDED_QR_MM;

  return (
    <div className="pt-print">
      <style>{PRINT_CSS}</style>

      <div className="pt-toolbar no-print">
        <Link href={`/admin/property-tags/${groupId}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 700, color: "var(--accent-primary)" }}>
          <ArrowLeft size={16} /> {groupName}
        </Link>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: "var(--text-primary)" }}>{t.adminPtPrintTitle}</h1>

        <div className="pt-controls">
          <div className="field">
            <label className="label" htmlFor="pt-per-page">{t.adminPtPerPage}</label>
            <input
              id="pt-per-page"
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
          </div>
          {seriesList.length > 1 && (
            <div className="field">
              <label className="label" htmlFor="pt-series-filter">{t.adminPtSeries}</label>
              <select id="pt-series-filter" className="input" value={series} onChange={(e) => setSeries(e.target.value)}>
                <option value="">{t.adminPtPrintSeriesAll}</option>
                {seriesList.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label className="label" htmlFor="pt-from">{t.adminPtRangeFrom}</label>
            <input id="pt-from" className="input" type="number" inputMode="numeric" min={1} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="pt-to">{t.adminPtRangeTo}</label>
            <input id="pt-to" className="input" type="number" inputMode="numeric" min={1} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--text-secondary)", cursor: "pointer" }}>
          <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} />
          {t.adminPtPrintOnlyEmpty}
        </label>

        <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
          {t.adminPtPrintSummary
            .replace("{count}", String(selected.length))
            .replace("{pages}", String(pages.length))
            .replace("{cols}", String(grid.cols))
            .replace("{rows}", String(grid.rows))
            .replace("{size}", qr.toFixed(0))}
        </p>
        {tooSmall && <Warning text={t.adminPtPrintSmallWarning} />}
        {origin && looksLocal(origin) && <Warning text={t.adminPtPrintOriginWarning.replace("{origin}", origin)} />}
        <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t.adminPtPrintHint}</p>

        <button className="btn btn-primary" onClick={() => window.print()} disabled={selected.length === 0 || !origin} style={{ alignSelf: "flex-start" }}>
          <Printer size={18} /> {t.adminPtPrintBtn}
        </button>
        {selected.length === 0 && <p style={{ fontSize: 14, color: "var(--text-muted)" }}>{t.adminPtNoMatch}</p>}
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

function Warning({ text }: { text: string }) {
  return (
    <p style={{ display: "flex", gap: 8, alignItems: "flex-start", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 600, lineHeight: 1.5, background: "rgb(var(--amber-500-rgb) / 0.12)", color: "var(--amber-700)" }}>
      <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> {text}
    </p>
  );
}

// Sizes are real millimetres so the printed sheet matches the on-screen
// preview at 100% scale. Colours are literal black/white on purpose: the sheet
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

@page { size: A4 portrait; margin: 10mm; }
@media print {
  /* Same flattening as the prize report: the admin shell is a fixed-height
     scroll box, so drop its chrome and let every page reach the printer. */
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body:has(.pt-print) header,
  body:has(.pt-print) aside,
  body:has(.pt-print) nav,
  .no-print { display: none !important; }
  body:has(.pt-print) div:has(> main),
  body:has(.pt-print) main {
    display: block !important; height: auto !important; overflow: visible !important;
    padding: 0 !important; background: #fff !important;
  }
  .pt-pages { display: block; gap: 0; overflow: visible; padding: 0; }
  .pt-page { box-shadow: none; break-after: page; page-break-after: always; }
  .pt-page:last-child { break-after: auto; page-break-after: auto; }
  .pt-print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;
