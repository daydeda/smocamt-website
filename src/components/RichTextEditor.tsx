"use client";

import { useRef } from "react";
import { Bold, Link2 } from "lucide-react";
import { parseRichText } from "@/lib/rich-text";

// Reusable rich-text editor: a textarea plus a Bold / Link / Color toolbar that
// inserts the same **bold** / [text](url) / {{color:#hex|text}} markup the rest of
// the app renders through parseRichText(). Originally the announcement editor's
// inline logic, lifted out so the shop product editor shares it.
export function RichTextEditor({
  value,
  onChange,
  rows = 5,
  placeholder,
  showPreview = true,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  showPreview?: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

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
    const label = sel || "link text";
    const url = "https://";
    apply(start, end, `[${label}](${url})`, start + `[${label}](`.length, url.length);
  };

  const toolBtn: React.CSSProperties = {
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

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <button type="button" style={toolBtn} onClick={() => toggleWrap("**", "**", "text")} title="Bold / unbold — **text**">
          <Bold size={15} /> Bold
        </button>
        <button type="button" style={toolBtn} onClick={toggleLink} title="Link / unlink — [text](https://…)">
          <Link2 size={15} /> Link
        </button>
        <label style={{ ...toolBtn, position: "relative" }} title="Text color — {{color:#HEX|text}}">
          <span style={{ width: 15, height: 15, borderRadius: 4, background: "linear-gradient(135deg,var(--red-500),var(--indigo-500))", display: "inline-block" }} />
          Color
          <input
            type="color"
            defaultValue="#ff6b00"
            onChange={(e) => applyColor(e.target.value)}
            style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
          />
        </label>
      </div>

      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
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
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
        <code>**bold**</code> · <code>[text](https://…)</code> · <code>{`{{color:#ff6b00|text}}`}</code>
      </p>

      {showPreview && value.trim() !== "" && (
        <div style={{ marginTop: 12 }}>
          <label style={{ display: "block", fontWeight: 700, fontSize: 12, marginBottom: 6, color: "var(--text-muted)" }}>Preview</label>
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
