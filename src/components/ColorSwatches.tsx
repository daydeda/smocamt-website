"use client";

// Preset text colours plus a custom picker, for the rich-text toolbars. Swatches
// apply on click, so the same colour can be applied again to another word. A bare
// <input type="color"> cannot do that: browsers skip `change` when the picked
// value equals the current one, so the second apply silently did nothing.
export const TEXT_COLORS = ["#ff6b00", "#e11d48", "#16a34a", "#2563eb", "#7c3aed", "#111827", "#6b7280"];

export function ColorSwatches({ onPick, label = "Text colour" }: { onPick: (hex: string) => void; label?: string }) {
  return (
    <>
      {TEXT_COLORS.map((hex) => (
        <button
          key={hex}
          type="button"
          title={`${label} ${hex}`}
          aria-label={`${label} ${hex}`}
          // Keep the textarea's selection when the button is pressed.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(hex)}
          style={{ width: 24, height: 24, borderRadius: 99, background: hex, border: "2px solid var(--bg-surface)", boxShadow: "0 0 0 1px var(--border-medium)", cursor: "pointer", padding: 0 }}
        />
      ))}
      <label
        title={`${label} (custom)`}
        style={{ position: "relative", width: 24, height: 24, borderRadius: 99, background: "conic-gradient(#ef4444, #f59e0b, #22c55e, #3b82f6, #a855f7, #ef4444)", boxShadow: "0 0 0 1px var(--border-medium)", cursor: "pointer", display: "inline-block" }}
      >
        <input
          type="color"
          defaultValue="#ff6b00"
          onChange={(e) => {
            const hex = e.target.value;
            // Reset to a value no swatch uses so the next pick, even the same
            // colour, is a real change and fires onChange again.
            e.target.value = "#000000";
            onPick(hex);
          }}
          style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}
        />
      </label>
    </>
  );
}
