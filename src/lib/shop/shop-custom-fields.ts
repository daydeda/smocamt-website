import { z } from "zod";

// Generic per-product personalization fields (e.g. a jersey's "Name on back" /
// "Number"). The field CONFIG lives on shop_products.customFields; the buyer's
// answers are snapshotted onto shop_order_items.customValues as [{label, value}]
// so order history + the admin export stay readable even if the product's field
// config is later edited or the product is deleted (same snapshot posture as
// productName / variantLabel).

export type ShopCustomFieldType = "text" | "number" | "select";

export interface ShopCustomField {
  key: string;
  label: string;
  type: ShopCustomFieldType;
  required: boolean;
  maxLength?: number | null; // text only
  min?: number | null;       // number only
  max?: number | null;       // number only
  options?: string[];        // select only
}

// One snapshotted answer on an order line.
export interface ShopCustomValue {
  label: string;
  value: string;
}

// Config validation — used by the admin product schema. Keys are assigned by the
// admin form (cf1, cf2, …); they only need to be unique within a product and to
// match between GET /api/shop and the order POST.
export const customFieldSchema = z.object({
  key: z.string().min(1).max(40),
  // Labels/options hold bilingual (Thai + English) text, so allow generous room.
  label: z.string().min(1).max(1000),
  type: z.enum(["text", "number", "select"]),
  required: z.boolean().default(false),
  maxLength: z.number().int().min(1).max(1000).nullable().default(null),
  min: z.number().int().nullable().default(null),
  max: z.number().int().nullable().default(null),
  options: z.array(z.string().min(1).max(1000)).max(30).default([]),
});

/**
 * Validate a buyer's raw answers (key → value) for ONE product against its field
 * config, server-side. Returns the readable snapshot to persist, or an error
 * message safe to show the buyer. Never trust the client: this is authoritative.
 */
export function validateCustomAnswers(
  fields: ShopCustomField[] | null | undefined,
  answers: Record<string, string> | undefined,
  productName: string
): { ok: true; snapshot: ShopCustomValue[] } | { ok: false; error: string } {
  const defs = fields ?? [];
  const given = answers ?? {};
  const snapshot: ShopCustomValue[] = [];

  for (const f of defs) {
    const raw = (given[f.key] ?? "").trim();

    if (!raw) {
      if (f.required) return { ok: false, error: `Please fill in "${f.label}" for ${productName}.` };
      continue; // optional + blank → omit from the snapshot
    }

    if (f.type === "number") {
      const n = Number(raw);
      if (!Number.isInteger(n)) {
        return { ok: false, error: `"${f.label}" on ${productName} must be a whole number.` };
      }
      if (f.min != null && n < f.min) return { ok: false, error: `"${f.label}" on ${productName} must be at least ${f.min}.` };
      if (f.max != null && n > f.max) return { ok: false, error: `"${f.label}" on ${productName} must be at most ${f.max}.` };
    } else if (f.type === "select") {
      if (f.options && f.options.length > 0 && !f.options.includes(raw)) {
        return { ok: false, error: `"${raw}" is not a valid choice for "${f.label}" on ${productName}.` };
      }
    } else {
      const cap = f.maxLength ?? 200;
      if (raw.length > cap) return { ok: false, error: `"${f.label}" on ${productName} is too long (max ${cap}).` };
    }

    snapshot.push({ label: f.label, value: raw });
  }

  return { ok: true, snapshot };
}
