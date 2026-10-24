// Thai mobile numbers are stored as 10 digits; the input shows them chunked 3-3-4.

/** Keep digits only, capped at 10 (the stored form). */
export const phoneDigits = (v: string) => v.replace(/[^0-9]/g, "").slice(0, 10);

/** 0812345678 -> 081-234-5678 (partial input is chunked as far as it goes). */
export function formatPhone(v: string): string {
  const d = phoneDigits(v);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}
