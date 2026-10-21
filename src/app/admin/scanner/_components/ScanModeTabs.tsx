"use client";

import type { ScannerScreenCtx } from "../_lib/useScannerScreen";

export function ScanModeTabs({ ctx }: { ctx: ScannerScreenCtx }) {
  const { canPrize, canProperty, canScore, canShop, scanMode, selectMode, t } = ctx;
  return (
    <>{(canScore || canPrize || canShop || canProperty) && (
        <div style={{
          display: "flex",
          maxWidth: "100%",
          // Up to five tabs now (Tags added) — scroll rather than overflow at 360px.
          overflowX: "auto",
          background: "var(--bg-elevated)",
          padding: 4, 
          borderRadius: 12, 
          border: "1px solid var(--border-subtle)" 
        }}>
          {([
            { mode: "checkin", label: t.scanModeCheckin, show: true },
            { mode: "score", label: t.scanModeScore, show: canScore },
            { mode: "prize", label: t.scanModePrize, show: canPrize },
            { mode: "shop", label: t.scanModeShop, show: canShop },
            { mode: "property", label: t.scanModeProperty, show: canProperty },
          ] as const).filter((m) => m.show).map((m) => (
            <button
              key={m.mode}
              onClick={() => selectMode(m.mode)}
              aria-pressed={scanMode === m.mode}
              style={{
                flex: "1 1 auto",
                // Tight enough that three Thai labels stay on one line at 360px.
                padding: "8px 10px",
                borderRadius: 10,
                fontSize: 13,
                whiteSpace: "nowrap",
                fontWeight: 700,
                background: scanMode === m.mode ? "var(--bg-surface)" : "transparent",
                color: scanMode === m.mode ? "var(--text-primary)" : "var(--text-muted)",
                boxShadow: scanMode === m.mode ? "0 4px 12px rgb(var(--shadow-rgb) / 0.05)" : "none",
                border: "none",
                cursor: "pointer",
                transition: "all 0.2s"
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        )}</>
  );
}
