/**
 * `color` at `opacity` (0–1), as a CSS colour string.
 *
 * Use this instead of appending hex alpha digits (`${color}20`): that only
 * works when `color` is a 6-digit hex, and silently produces invalid CSS once
 * it is a palette token such as `var(--red-500)`. color-mix accepts hex, rgb()
 * and var() alike. See the palette notes in src/app/globals.css.
 */
export function alpha(color: string, opacity: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(opacity * 1000) / 10}%, transparent)`;
}
