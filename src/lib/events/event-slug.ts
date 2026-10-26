// Short, readable public event links: /e/<title-slug>-<first 8 hex of the id>.
// The slug is cosmetic; only the trailing 8 hex characters identify the event, so
// a renamed event keeps working and a full-UUID link (older shares) still resolves.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_RE = /(?:^|-)([0-9a-f]{8})$/i;

export function slugifyTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "event";
}

/** The public path for an event: the owner's custom link name if set, else title + id prefix. */
export function eventRef(id: string, title: string, shortSlug?: string | null): string {
  return shortSlug || `${slugifyTitle(title)}-${id.slice(0, 8).toLowerCase()}`;
}

export function eventPath(id: string, title: string, shortSlug?: string | null): string {
  return `/e/${eventRef(id, title, shortSlug)}`;
}

/** Whether a link reference (custom name, slug-prefix form or full id) points at this event. */
export function matchesEventRef(
  e: { id: string; title: string; shortSlug?: string | null },
  ref: string,
): boolean {
  const r = ref.toLowerCase();
  return e.id.toLowerCase() === r || eventRef(e.id, e.title, e.shortSlug) === r;
}

// Words that would read as (or collide with) other routes or the id-based forms.
const RESERVED_SLUGS = new Set([
  "admin", "api", "new", "edit", "create", "dashboard", "login", "logout", "e", "event", "events",
  "calendar", "profile", "shop", "houses", "scan", "feedback", "uploads", "null", "undefined",
]);

export const SHORT_SLUG_MIN = 3;
export const SHORT_SLUG_MAX = 40;

export type ShortSlugResult =
  | { ok: true; slug: string | null }
  | { ok: false; reason: "format" | "reserved" };

/** Normalises an owner-typed link name. Empty input clears it (slug: null). */
export function normalizeShortSlug(input: string | null | undefined): ShortSlugResult {
  const raw = (input ?? "").trim().toLowerCase();
  if (!raw) return { ok: true, slug: null };
  if (raw.length < SHORT_SLUG_MIN || raw.length > SHORT_SLUG_MAX) return { ok: false, reason: "format" };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw)) return { ok: false, reason: "format" };
  // Must never look like an id (full UUID or a bare 8-hex prefix).
  if (UUID_RE.test(raw) || /^[0-9a-f]{8}$/.test(raw)) return { ok: false, reason: "format" };
  if (RESERVED_SLUGS.has(raw)) return { ok: false, reason: "reserved" };
  return { ok: true, slug: raw };
}

export type EventRef = { kind: "id"; id: string } | { kind: "prefix"; prefix: string };

export function parseEventRef(ref: string): EventRef | null {
  if (UUID_RE.test(ref)) return { kind: "id", id: ref };
  const m = SHORT_RE.exec(ref);
  return m ? { kind: "prefix", prefix: m[1].toLowerCase() } : null;
}
