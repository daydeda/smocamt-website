"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { Bold, Link2 } from "lucide-react";
import { parseRichText } from "@/lib/ui/rich-text";
import { ColorSwatches } from "@/components/ColorSwatches";

// Reusable rich-text editor: a textarea plus a Bold / Link / Color toolbar that
// inserts the same **bold** / [text](url) / {{color:#hex|text}} markup the rest of
// the app renders through parseRichText(). Shared by the shop editors, the
// announcement editor and the event / proposal description fields.
//
// layout="stacked" (default): toolbar, textarea, hint, then a compact preview.
// layout="split": full-width editor with the live preview beside it (stacked on
// phones), for long descriptions that need re-reading.
export function RichTextEditor({
  value,
  onChange,
  rows = 5,
  placeholder,
  showPreview = true,
  layout = "stacked",
  minHeight = 320,
  maxLength,
  lang = "en",
  label,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  showPreview?: boolean;
  layout?: "stacked" | "split";
  /** split layout only: minimum height of the editor and preview panels. */
  minHeight?: number;
  maxLength?: number;
  lang?: string;
  /** split layout only: field label shown at the left of the toolbar row. */
  label?: ReactNode;
  /** Extra helper text shown above the markup cheat-sheet. */
  hint?: ReactNode;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const th = lang === "th";

  // Replace [start,end) with `replacement` and re-select `selLen` chars from
  // `selStart`, keeping focus in the textarea.
  const apply = (start: number, end: number, replacement: string, selStart: number, selLen: number) => {
    const ta = taRef.current;
    onChange(value.slice(0, start) + replacement + value.slice(end));
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(selStart, selStart + selLen);
    });
  };

  // Toggle a paired marker (e.g. **…**): strip it if present, else wrap.
  const toggleWrap = (before: string, after: string, placeholderText: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = value.slice(start, end);

    if (sel.length >= before.length + after.length && sel.startsWith(before) && sel.endsWith(after)) {
      const inner = sel.slice(before.length, sel.length - after.length);
      apply(start, end, inner, start, inner.length);
      return;
    }
    if (value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after) {
      apply(start - before.length, end + after.length, sel, start - before.length, sel.length);
      return;
    }
    const inner = sel || placeholderText;
    apply(start, end, before + inner + after, start + before.length, inner.length);
  };

  // Replace the color of an already-selected {{color:…|…}} block instead of
  // nesting another one; otherwise wrap the selection in a new color block.
  const applyColor = (hex: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = value.slice(start, end);
    const m = sel.match(/^\{\{color:[^|]*\|([\s\S]*)\}\}$/);
    const inner = m ? m[1] : sel || "text";
    const block = `{{color:${hex}|${inner}}}`;
    apply(start, end, block, start, block.length);
  };

  const toggleLink = () => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = value.slice(start, end);
    const m = sel.match(/^\[([\s\S]*?)\]\(([\s\S]*?)\)$/);
    if (m) {
      apply(start, end, m[1], start, m[1].length);
      return;
    }
    const linkLabel = sel || "link text";
    const url = "https://";
    apply(start, end, `[${linkLabel}](${url})`, start + `[${linkLabel}](`.length, url.length);
  };

  const toolBtn: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 34,
    padding: "0 12px",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-base)",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  };

  // Keep the textarea's text selection when a toolbar button is pressed.
  const keepSelection = (e: { preventDefault: () => void }) => e.preventDefault();

  const toolbar = (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <button type="button" style={toolBtn} onMouseDown={keepSelection} onClick={() => toggleWrap("**", "**", "text")} title="Bold / unbold: **text**">
        <Bold size={15} /> {th ? "ตัวหนา" : "Bold"}
      </button>
      <button type="button" style={toolBtn} onMouseDown={keepSelection} onClick={toggleLink} title="Link / unlink: [text](https://…)">
        <Link2 size={15} /> {th ? "ลิงก์" : "Link"}
      </button>
      <span aria-hidden style={{ width: 1, height: 22, background: "var(--border-subtle)", margin: "0 2px" }} />
      <ColorSwatches onPick={applyColor} label={th ? "สีตัวอักษร" : "Text colour"} />
    </div>
  );

  const cheatSheet = (
    <>
      {hint && <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>{hint}</p>}
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: hint ? 4 : 8, lineHeight: 1.6 }}>
        <code>**bold**</code> · <code>[text](https://…)</code> · <code>{`{{color:#ff6b00|text}}`}</code>
        {" "}· {th ? "เลือกข้อความก่อน แล้วกดสีเพื่อใส่สี" : "select text first, then click a colour"}
      </p>
    </>
  );

  if (layout === "split") {
    const caption: CSSProperties = { fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 };
    return (
      <div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
          {label ?? <span />}
          {toolbar}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={caption}>{th ? "เขียน" : "Write"}</span>
            <textarea
              ref={taRef}
              className="input"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              maxLength={maxLength}
              placeholder={placeholder}
              style={{ flex: 1, minHeight, resize: "vertical", borderRadius: 16, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", fontSize: 15, lineHeight: 1.7, padding: 18 }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={caption}>{th ? "ตัวอย่างการแสดงผล" : "Live Preview"}</span>
            <div
              className="custom-scrollbar"
              style={{ flex: 1, minHeight, maxHeight: Math.max(minHeight, 640), overflowY: "auto", overflowWrap: "anywhere", background: "var(--bg-surface)", borderRadius: 16, padding: 22, fontSize: 16, lineHeight: 1.75, color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
              dangerouslySetInnerHTML={{
                __html: parseRichText(value) || `<span style="color: var(--text-muted); font-style: italic;">${th ? "ยังไม่มีเนื้อหา..." : "No content yet..."}</span>`,
              }}
            />
          </div>
        </div>
        {cheatSheet}
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 10 }}>{toolbar}</div>

      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: 14,
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-subtle)",
          fontSize: 15,
          lineHeight: 1.6,
          resize: "vertical",
          fontFamily: "inherit",
          background: "var(--bg-base)",
        }}
      />
      {cheatSheet}

      {showPreview && value.trim() !== "" && (
        <div style={{ marginTop: 12 }}>
          <label style={{ display: "block", fontWeight: 700, fontSize: 12, marginBottom: 6, color: "var(--text-muted)" }}>{th ? "ตัวอย่าง" : "Preview"}</label>
          <div
            style={{
              fontSize: 14,
              color: "var(--text-secondary)",
              padding: 12,
              borderRadius: "var(--radius-md)",
              background: "var(--bg-base)",
              border: "1px solid var(--border-subtle)",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
            dangerouslySetInnerHTML={{ __html: parseRichText(value) }}
          />
        </div>
      )}
    </div>
  );
}
