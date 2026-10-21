// Pure helpers for property tags (ป้ายทรัพย์สิน) — printed QR stickers that
// staff assign to a student's bag/phone. No DB access here, so the code
// format, label format and A4 layout maths are unit-testable and safe to
// import from client components. See docs/features/property-tags.md.

// Crockford base32: no I/L/O/U, so a code read off a scuffed sticker and typed
// in by hand can't be mistaken for another one. 10 chars = 50 bits — enough
// that walking /t/<code> URLs to harvest student names is hopeless.
export const TAG_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const TAG_CODE_LENGTH = 10;

// The path a printed QR points at. Short on purpose: a shorter URL is a less
// dense QR, which stays readable when printed small.
export const TAG_PATH_PREFIX = "/t/";

// Hard caps the API enforces; the UI uses the same numbers.
export const MAX_TAGS_PER_BATCH = 1000;
export const MAX_TAGS_PER_PAGE = 80;

// Below this a phone camera struggles with the QR at arm's length, so the
// print page warns (but still lets staff print).
export const MIN_RECOMMENDED_QR_MM = 20;

export function generateTagCode(
  randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  // 256 % 32 === 0, so masking to 5 bits has no modulo bias.
  const bytes = randomBytes(TAG_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < TAG_CODE_LENGTH; i++) out += TAG_CODE_ALPHABET[bytes[i] & 31];
  return out;
}

/**
 * Accepts whatever a scanner or a person produced — the full printed URL
 * (`https://host/t/K7M2QX9TPA`), a bare code, lowercase, with spaces/dashes —
 * and returns the canonical code, or null if it can't be one. Applies
 * Crockford's read-aloud mapping (O→0, I/L→1) for hand-typed codes.
 */
export function normalizeTagCode(input: string | null | undefined): string | null {
  let raw = (input ?? "").trim();
  if (!raw) return null;
  const idx = raw.indexOf(TAG_PATH_PREFIX);
  if (idx !== -1) raw = raw.slice(idx + TAG_PATH_PREFIX.length);
  raw = raw.split(/[?#/]/)[0];
  const code = raw
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (code.length !== TAG_CODE_LENGTH) return null;
  for (const ch of code) if (!TAG_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export function tagUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}${TAG_PATH_PREFIX}${code}`;
}

/** Series is a short stock-keeping prefix like "SMO", "ANU", "STU". */
export function normalizeSeries(input: string | null | undefined): string | null {
  const s = (input ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{1,8}$/.test(s) ? s : null;
}

/** "SMO-014". Pads to 3 digits; grows naturally past 999. */
export function formatTagLabel(series: string, serial: number): string {
  return `${series}-${String(serial).padStart(3, "0")}`;
}

// Series that HINT at a role. Used only for a soft "are you sure?" when staff
// give e.g. an SMO-series sticker to someone without the smo role — never
// enforced, and never re-checked after assignment (the series is just which
// pile the sticker came from).
const SERIES_ROLE_HINT: Record<string, string> = {
  SMO: "smo",
  ANU: "anusmo",
  ANUSMO: "anusmo",
};

export function seriesRoleMismatch(series: string, ownerRoles: string[]): string | null {
  const role = SERIES_ROLE_HINT[series.toUpperCase()];
  if (!role) return null;
  return ownerRoles.includes(role) ? null : role;
}

/** Last 4 digits of a phone, for telling two same-named students apart. */
export function maskPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `•••${digits.slice(-4)}` : null;
}

// A4 portrait minus the print page's 10mm margins.
export const A4_PRINTABLE_MM = { width: 190, height: 277 } as const;

export interface LabelGrid {
  cols: number;
  rows: number;
  cellWidthMm: number;
  cellHeightMm: number;
  qrMm: number;
}

/**
 * Lay N labels on one A4 page so the QR comes out as large as possible. A
 * label is the logo, the QR, the serial and the code stacked vertically —
 * roughly 1.7× as tall as the QR is wide — so the best grid isn't always the
 * squarest one.
 */
export function labelGridForPerPage(perPage: number): LabelGrid {
  const n = Math.max(1, Math.min(MAX_TAGS_PER_PAGE, Math.floor(perPage)));
  const { width, height } = A4_PRINTABLE_MM;
  let best: LabelGrid | null = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellWidthMm = width / cols;
    const cellHeightMm = height / rows;
    const qrMm = Math.min(cellWidthMm * 0.8, (cellHeightMm * 0.86) / 1.7);
    // Prefer the bigger QR; on a tie, the grid that wastes fewer cells.
    if (!best || qrMm > best.qrMm + 0.01 || (Math.abs(qrMm - best.qrMm) <= 0.01 && cols * rows < best.cols * best.rows)) {
      best = { cols, rows, cellWidthMm, cellHeightMm, qrMm };
    }
  }
  return best!;
}
