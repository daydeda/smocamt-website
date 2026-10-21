/**
 * Escapes a single value for a CSV cell.
 *
 * Two attacks this guards against, both via student-supplied text (names,
 * nicknames) ending up in admin exports:
 * - Broken quoting: an embedded `"` un-balances the cell and shifts every
 *   following column. Fixed by doubling quotes per RFC 4180.
 * - Formula injection: Excel/Sheets execute cells starting with = + - @ as
 *   formulas (e.g. `=cmd|...`). Neutralized with a leading apostrophe, which
 *   spreadsheets treat as "display as text".
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  return `"${s.replace(/"/g, '""')}"`;
}
