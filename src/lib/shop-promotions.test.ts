import { describe, it, expect } from "vitest";
import {
  computeBundleCost,
  computeBundleDiscount,
  findBundleScopeConflict,
  normalizeBundleDeals,
  resolveBundleDeals,
} from "@/lib/shop-promotions";

const qty = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe("computeBundleCost", () => {
  it("charges singles when there are no deals", () => {
    expect(computeBundleCost(40, 3, null)).toBe(120);
    expect(computeBundleCost(40, 3, [])).toBe(120);
  });

  it("applies a 3-for-100 deal and charges leftovers at the unit price", () => {
    const deals = [{ qty: 3, price: 100 }];
    expect(computeBundleCost(40, 2, deals)).toBe(80);
    expect(computeBundleCost(40, 3, deals)).toBe(100);
    expect(computeBundleCost(40, 4, deals)).toBe(140);
    expect(computeBundleCost(40, 6, deals)).toBe(200);
    expect(computeBundleCost(40, 7, deals)).toBe(240);
  });

  it("picks the cheapest mix, not greedy largest-first", () => {
    const deals = [{ qty: 3, price: 100 }, { qty: 5, price: 150 }];
    expect(computeBundleCost(40, 6, deals)).toBe(190);
    expect(computeBundleCost(40, 8, deals)).toBe(250);
    // Greedy trap: 4-for-100 & 3-for-60, qty 6 → 3+3 (120) beats 4+1+1 (180).
    expect(computeBundleCost(40, 6, [{ qty: 4, price: 100 }, { qty: 3, price: 60 }])).toBe(120);
  });

  it("ignores a deal that is worse than buying singles", () => {
    expect(computeBundleCost(30, 3, [{ qty: 3, price: 100 }])).toBe(90);
  });

  it("handles zero quantity", () => {
    expect(computeBundleCost(40, 0, [{ qty: 3, price: 100 }])).toBe(0);
  });
});

describe("computeBundleDiscount", () => {
  const S = { id: "s", priceDelta: 0 };
  const M = { id: "m", priceDelta: 0 };
  const XXL = { id: "xxl", priceDelta: 20 };

  it("counts every option together for an all-options deal", () => {
    const product = { price: 40, bundleDeals: [{ qty: 3, price: 100 }] };
    expect(computeBundleDiscount(product, [S, M], qty({ s: 2 }))).toBe(0);
    expect(computeBundleDiscount(product, [S, M], qty({ s: 3 }))).toBe(20);
    expect(computeBundleDiscount(product, [S, M], qty({ s: 2, m: 1 }))).toBe(20);
    expect(computeBundleDiscount(product, [S, M], qty({ s: 4, m: 2 }))).toBe(40);
  });

  it("keeps a pricier option's surcharge on top (reference = cheapest option)", () => {
    // 2×S + 1×XXL: lines 40+40+60 = 140, bundle 100 + XXL's +20 = 120 → saves 20.
    const product = { price: 40, bundleDeals: [{ qty: 3, price: 100 }] };
    expect(computeBundleDiscount(product, [S, XXL], qty({ s: 2, xxl: 1 }))).toBe(20);
  });

  it("works when the base price is 0 and options are priced by surcharge", () => {
    const screen = { id: "screen", priceDelta: 40 };
    const embroid = { id: "embroid", priceDelta: 80 };
    const product = { price: 0, bundleDeals: [{ qty: 3, price: 100, variantIds: ["screen"] }] };
    // 3 screen prints: 120 → 100.
    expect(computeBundleDiscount(product, [screen, embroid], qty({ screen: 3 }))).toBe(20);
    // Embroidery never counts toward the screen-print deal.
    expect(computeBundleDiscount(product, [screen, embroid], qty({ screen: 2, embroid: 1 }))).toBe(0);
    expect(computeBundleDiscount(product, [screen, embroid], qty({ embroid: 3 }))).toBe(0);
    expect(computeBundleDiscount(product, [screen, embroid], qty({ screen: 3, embroid: 5 }))).toBe(20);
  });

  it("prices separate option groups independently", () => {
    const product = {
      price: 40,
      bundleDeals: [
        { qty: 3, price: 100, variantIds: ["s"] },
        { qty: 2, price: 70, variantIds: ["m"] },
      ],
    };
    expect(computeBundleDiscount(product, [S, M], qty({ s: 3, m: 2 }))).toBe(20 + 10);
    // Units don't cross groups: 2×S + 1×M reaches neither deal.
    expect(computeBundleDiscount(product, [S, M], qty({ s: 2, m: 1 }))).toBe(0);
  });

  it("ignores a scoped deal whose options were all deleted", () => {
    const product = { price: 40, bundleDeals: [{ qty: 3, price: 100, variantIds: ["gone"] }] };
    expect(computeBundleDiscount(product, [S], qty({ s: 3 }))).toBe(0);
  });

  it("is never negative", () => {
    expect(computeBundleDiscount({ price: 30, bundleDeals: [{ qty: 3, price: 100 }] }, [S], qty({ s: 3 }))).toBe(0);
  });
});

describe("findBundleScopeConflict", () => {
  const all = ["a", "b", "c"];
  it("allows identical and disjoint option sets", () => {
    expect(findBundleScopeConflict([{}, {}], all)).toBe(false);
    expect(findBundleScopeConflict([{ variantIds: ["a"] }, { variantIds: ["b", "c"] }], all)).toBe(false);
    expect(findBundleScopeConflict([{ variantIds: ["a", "b"] }, { variantIds: ["b", "a"] }], all)).toBe(false);
  });
  it("rejects overlapping but different sets", () => {
    expect(findBundleScopeConflict([{}, { variantIds: ["a"] }], all)).toBe(true);
    expect(findBundleScopeConflict([{ variantIds: ["a", "b"] }, { variantIds: ["b"] }], all)).toBe(true);
  });
});

describe("normalizeBundleDeals", () => {
  it("drops invalid rows, dedupes by (options, qty) with last winning, sorts", () => {
    expect(
      normalizeBundleDeals([
        { qty: 5, price: 150 },
        { qty: 1, price: 30 },
        { qty: 3, price: 110 },
        { qty: 3, price: 100 },
        { qty: 3, price: 90, variantIds: ["b", "a", "a"] },
        { qty: 2, price: 10, variantIds: [] },
        { qty: Number.NaN, price: 10 },
      ])
    ).toEqual([
      { qty: 3, price: 100 },
      { qty: 5, price: 150 },
      { qty: 3, price: 90, variantIds: ["a", "b"] },
    ]);
  });
});

describe("resolveBundleDeals", () => {
  const ids = ["id-screen", "id-embroid"];
  it("maps option indexes to ids", () => {
    expect(resolveBundleDeals([{ qty: 3, price: 100, variantIndexes: [0] }], ids)).toEqual({
      ok: true,
      deals: [{ qty: 3, price: 100, variantIds: ["id-screen"] }],
    });
  });
  it("treats selecting every option as all options", () => {
    expect(resolveBundleDeals([{ qty: 3, price: 100, variantIndexes: [1, 0] }], ids)).toEqual({
      ok: true,
      deals: [{ qty: 3, price: 100 }],
    });
  });
  it("rejects out-of-range indexes and overlapping scopes", () => {
    expect(resolveBundleDeals([{ qty: 3, price: 100, variantIndexes: [5] }], ids).ok).toBe(false);
    expect(resolveBundleDeals([{ qty: 3, price: 100 }, { qty: 2, price: 70, variantIndexes: [0] }], ids).ok).toBe(false);
  });
});
