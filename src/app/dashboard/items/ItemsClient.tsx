"use client";

import Link from "next/link";
import { PackageOpen, QrCode, Tag } from "lucide-react";
import { StudentNav } from "@/components/layout/StudentNav";
import { useLanguage } from "@/lib/LanguageContext";

interface Item {
  label: string;
  groupName: string;
  groupDescription: string | null;
  assignedAt: string | null;
}

const TZ = "Asia/Bangkok";
const LOCALES = { en: "en-GB", th: "th-TH", mm: "en-GB", cn: "zh-CN" } as const;

export default function ItemsClient({ items }: { items: Item[] }) {
  const { t, lang } = useLanguage();

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString(LOCALES[lang as keyof typeof LOCALES] ?? "en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });

  return (
    <div style={{ background: "var(--bg-base)", minHeight: "100vh" }}>
      <StudentNav />

      <main className="page-container" style={{ marginTop: 48, paddingBottom: 100 }}>
        <div style={{ marginBottom: 32, display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: "clamp(30px,6vw,40px)", fontWeight: 900, letterSpacing: "-0.04em", marginBottom: 10 }}>{t.itemsTitle}</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 16, fontWeight: 500 }}>{t.itemsSubtitle}</p>
          </div>
          <Link href="/dashboard/scan" className="btn btn-primary btn-lg">
            <QrCode size={18} /> {t.itemsScanBtn}
          </Link>
        </div>

        {items.length === 0 ? (
          <div style={{ padding: "64px 24px", textAlign: "center", background: "var(--bg-surface)", borderRadius: 32, border: "2px dashed var(--border-subtle)", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <PackageOpen size={44} style={{ color: "var(--text-muted)" }} />
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", maxWidth: 420, lineHeight: 1.6 }}>{t.itemsEmpty}</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ listStyle: "none", padding: 0 }}>
            {items.map((it) => (
              <li key={it.label} className="stat-card" style={{ padding: "18px 20px", display: "flex", gap: 14, alignItems: "flex-start" }}>
                <span style={{ width: 44, height: 44, borderRadius: 14, background: "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--accent-primary)" }}>
                  <Tag size={22} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ fontSize: 17, fontWeight: 800, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{it.groupName}</h2>
                  {it.groupDescription && (
                    <p style={{ marginTop: 2, fontSize: 13.5, color: "var(--text-secondary)", overflowWrap: "anywhere" }}>{it.groupDescription}</p>
                  )}
                  <p style={{ marginTop: 8, fontSize: 14, fontWeight: 800, color: "var(--text-primary)", fontFamily: "ui-monospace, monospace", letterSpacing: "0.04em" }}>{it.label}</p>
                  {it.assignedAt && (
                    <p style={{ marginTop: 2, fontSize: 12.5, color: "var(--text-muted)" }}>{t.itemsAssignedOn.replace("{date}", fmt(it.assignedAt))}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

    </div>
  );
}
