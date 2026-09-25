import { describe, it, expect } from "vitest";
import { computeBundleCost, computeBundleDiscount, normalizeBundleDeals } from "@/lib/shop-promotions";

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
    // 6 units: greedy (5@150 + 1@40 = 190) vs 3+3 (2×100 = 200) → 190;
    // 8 units: 5+3 (250) beats 3+3+1+1 (280).
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
  it("is the saving vs. the full base price", () => {
    const product = { price: 40, bundleDeals: [{ qty: 3, price: 100 }] };
    expect(computeBundleDiscount(product, 2)).toBe(0);
    expect(computeBundleDiscount(product, 3)).toBe(20);
    expect(computeBundleDiscount(product, 6)).toBe(40);
  });

  it("is never negative", () => {
    expect(computeBundleDiscount({ price: 30, bundleDeals: [{ qty: 3, price: 100 }] }, 3)).toBe(0);
  });
});

describe("normalizeBundleDeals", () => {
  it("drops invalid rows, dedupes by qty (last wins), sorts ascending", () => {
    expect(
      normalizeBundleDeals([
        { qty: 5, price: 150 },
        { qty: 1, price: 30 },
        { qty: 3, price: 110 },
        { qty: 3, price: 100 },
        { qty: Number.NaN, price: 10 },
      ])
    ).toEqual([
      { qty: 3, price: 100 },
      { qty: 5, price: 150 },
    ]);
  });
});
