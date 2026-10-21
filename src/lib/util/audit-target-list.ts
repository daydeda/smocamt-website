// Formats a list of viewed/exported students for the audit_logs.target_id
// column when a single action exposes many people at once (a club/major
// roster read) — there's no single "the target" the way there is for a
// one-student action, and audit_logs has no metadata column to hold a
// structured list, so this becomes the row's targetId text directly. That
// column has no FK to users (schema.ts) specifically so it can hold free text
// like this; the audit-logs API falls back to showing it as-is when it
// doesn't resolve to a real user (src/app/api/admin/audit-logs/route.ts).
// Capped so a large major roster doesn't produce an unbounded audit row.
const MAX_LISTED = 30;

export function formatAuditTargetList(
  entries: { name: string | null | undefined; studentId?: string | null }[]
): string {
  const labels = entries.map((e) => `${e.name || "Unknown"} (${e.studentId || "—"})`);
  if (labels.length <= MAX_LISTED) return labels.join(", ");
  return `${labels.slice(0, MAX_LISTED).join(", ")}, +${labels.length - MAX_LISTED} more`;
}
