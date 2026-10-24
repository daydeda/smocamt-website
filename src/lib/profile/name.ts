// Name parts helpers (pure, no DB). users.name stays the display name and is rebuilt
// from the parts, so existing readers of users.name keep working.

const THAI_RE = /[฀-๿]/;
const LATIN_RE = /[A-Za-z]/;
// Thai letters/marks plus the separators a Thai name can contain.
const THAI_NAME_RE = /^[฀-๿\s.\-']+$/;

// A person's name or nickname may contain letters (any script, with their combining
// marks, so Thai vowels/tone marks and accented Latin work), spaces, hyphen, apostrophe
// and period. Digits (Arabic and Thai) and symbols such as * & , / | } are not names.
const INVALID_NAME_CHAR = /[^\p{L}\p{M} .'\u2019-]/u;
const INVALID_NAME_CHARS_G = /[^\p{L}\p{M} .'\u2019-]/gu;
export const hasInvalidNameChars = (s: string | null | undefined) => !!s && INVALID_NAME_CHAR.test(s);
/** Input filter for name fields: drops digits and symbols as they are typed or pasted. */
export const sanitizeNameInput = (s: string) => s.replace(INVALID_NAME_CHARS_G, "");

export type NameParts = { firstName?: string | null; middleName?: string | null; lastName?: string | null };

export const hasLatinLetters = (s: string | null | undefined) => !!s && LATIN_RE.test(s);
export const hasThaiLetters = (s: string | null | undefined) => !!s && THAI_RE.test(s);
/** True when a non-empty value is Thai script only (no Latin letters or digits). */
export const isThaiNameValue = (s: string | null | undefined) => !!s && THAI_NAME_RE.test(s.trim());

/** first + middle (if any) + last, single-spaced; empty parts are skipped. */
export function composeFullName(p: NameParts): string {
  return [p.firstName, p.middleName, p.lastName]
    .map((x) => (x ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Split a legacy single `name`. Only the unambiguous case (exactly two tokens) is
 * split; anything else returns null so the caller flags it for the student.
 */
export function splitLegacyName(name: string | null | undefined): { firstName: string; lastName: string } | null {
  const tokens = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length !== 2) return null;
  return { firstName: tokens[0], lastName: tokens[1] };
}

/** True if any provided part contains Latin letters. */
export function partsHaveLatin(p: NameParts): boolean {
  return hasLatinLetters(p.firstName) || hasLatinLetters(p.middleName) || hasLatinLetters(p.lastName);
}

/**
 * Validation for a submitted name. Returns an i18n-neutral error code or null.
 * - first and last are required
 * - unless the student confirmed a Latin name, parts must not contain Latin letters
 */
export function validateNameParts(
  p: NameParts,
  latinNameConfirmed: boolean,
): "nameRequired" | "nameInvalidChars" | "nameThaiOnly" | null {
  if (!(p.firstName ?? "").trim() || !(p.lastName ?? "").trim()) return "nameRequired";
  if (hasInvalidNameChars(p.firstName) || hasInvalidNameChars(p.middleName) || hasInvalidNameChars(p.lastName)) return "nameInvalidChars";
  if (!latinNameConfirmed && partsHaveLatin(p)) return "nameThaiOnly";
  return null;
}

/**
 * Pre-fill for a legacy row's name form: first token = first name, last token = last
 * name, anything between = middle. A suggestion only; the student confirms it.
 */
export function prefillNameParts(name: string | null | undefined): { firstName: string; middleName: string; lastName: string } {
  const tokens = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: "", middleName: "", lastName: "" };
  if (tokens.length === 1) return { firstName: tokens[0], middleName: "", lastName: "" };
  return {
    firstName: tokens[0],
    middleName: tokens.slice(1, -1).join(" "),
    lastName: tokens[tokens.length - 1],
  };
}

// ── Emergency contacts: same Thai-script rule as the student's own name ─────
// When the student's own name is Thai (latinNameConfirmed false) the contacts are
// almost always Thai citizens too (parents), so a Latin name or custom relationship
// needs an explicit per-contact "keep English" confirmation.

const KNOWN_RELATIONSHIPS = ["", "Father", "Mother", "Guardian", "Sibling", "Relative", "Friend"];

export type ContactNameInput = {
  name: string;
  relationship: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  latinNameConfirmed?: boolean;
};

/** The relationship text the student typed (custom "Other:" value or legacy free text). */
export function customRelationshipText(relationship: string | null | undefined): string {
  const r = (relationship ?? "").trim();
  if (r.startsWith("Other:")) return r.slice(6);
  return KNOWN_RELATIONSHIPS.includes(r) ? "" : r;
}

/** True when this contact must be confirmed (or retyped in Thai) before saving. */
export function contactNeedsLatinConfirm(c: ContactNameInput, studentLatinNameConfirmed: boolean): boolean {
  if (studentLatinNameConfirmed || c.latinNameConfirmed) return false;
  return (
    hasLatinLetters(c.name) ||
    hasLatinLetters(c.firstName) ||
    hasLatinLetters(c.middleName) ||
    hasLatinLetters(c.lastName) ||
    hasLatinLetters(customRelationshipText(c.relationship))
  );
}

type ContactWithParts = { name: string; firstName?: string; middleName?: string; lastName?: string };

/** Contacts saved by the split form carry name parts; older ones only have `name`. */
export const contactHasParts = (c: ContactWithParts) => c.firstName !== undefined || c.lastName !== undefined;

/** A contact has a usable name: first AND last when split, otherwise any `name`. */
export function contactHasName(c: ContactWithParts): boolean {
  if (contactHasParts(c)) return !!(c.firstName ?? "").trim() && !!(c.lastName ?? "").trim();
  return !!c.name.trim();
}

/** Rebuild the display `name` from the parts (kept so every reader of `name` still works). */
export function withComposedName<T extends ContactWithParts>(c: T): T {
  if (!contactHasParts(c)) return c;
  return { ...c, name: composeFullName(c) };
}

/** Give a legacy contact (name only) split parts the contact can confirm. */
export function prefillContactParts<T extends ContactWithParts>(c: T): T & { firstName: string; middleName: string; lastName: string } {
  if (contactHasParts(c)) {
    return { ...c, firstName: c.firstName ?? "", middleName: c.middleName ?? "", lastName: c.lastName ?? "" };
  }
  return { ...c, ...prefillNameParts(c.name) };
}
