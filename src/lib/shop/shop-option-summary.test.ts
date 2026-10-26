import { describe, it, expect } from "vitest";
import { summarizeOptions } from "./shop-option-summary";

const P = "headband";
const line = (variantLabel: string, quantity: number, productId: string | null = P) => ({ productId, variantLabel, quantity });

describe("summarizeOptions", () => {
  it("adds up quantity per option, split by status", () => {
    const { rows, total } = summarizeOptions([
      { status: "approved", items: [line("Embroidered", 1), line("Brown print", 6)] },
      { status: "pending", items: [line("Embroidered", 2)] },
      { status: "rejected", items: [line("Thai embroidered", 1)] },
    ], P);

    expect(rows).toEqual([
      { option: "Brown print", approved: 6, pending: 0, rejected: 0, active: 6, orders: 1 },
      { option: "Embroidered", approved: 1, pending: 2, rejected: 0, active: 3, orders: 2 },
      { option: "Thai embroidered", approved: 0, pending: 0, rejected: 1, active: 0, orders: 1 },
    ]);
    expect(total).toEqual({ option: "", approved: 7, pending: 2, rejected: 1, active: 9, orders: 3 });
  });

  it("ignores other products' lines in a mixed cart", () => {
    const { rows, total } = summarizeOptions([
      { status: "approved", items: [line("Embroidered", 1), line("XL", 3, "shirt"), line("Old", 1, null)] },
      { status: "approved", items: [line("M", 1, "shirt")] },
    ], P);
    expect(rows.map((r) => r.option)).toEqual(["Embroidered"]);
    expect(total.orders).toBe(1);
    expect(total.approved).toBe(1);
  });

  it("counts an order once per option even with repeated lines", () => {
    const { rows } = summarizeOptions([
      { status: "pending", items: [line("Embroidered", 1), line("Embroidered", 2)] },
    ], P);
    expect(rows[0]).toMatchObject({ option: "Embroidered", pending: 3, orders: 1 });
  });

  it("labels a blank option and handles no orders", () => {
    expect(summarizeOptions([{ status: "approved", items: [line("  ", 2)] }], P).rows[0].option).toBe("—");
    expect(summarizeOptions([], P)).toEqual({ rows: [], total: { option: "", approved: 0, pending: 0, rejected: 0, active: 0, orders: 0 } });
  });
});
