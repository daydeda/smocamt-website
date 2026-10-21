import { describe, it, expect } from "vitest";
import { computeBundleDiscount } from "@/lib/shop/shop-promotions";
import { effectiveUnitPrice, hasWelfare, normalUnitPrice, qualifiesForWelfare, welfareUnitPrice } from "@/lib/shop/shop-welfare";

// Option 1 costs ฿39, option 2 costs ฿89 (฿39 base + ฿50 surcharge).
const product = { price: 39, welfareRoles: ["smo"] };
const opt1 = { priceDelta: 0, welfarePrice: 29 };
const opt2 = { priceDelta: 50, welfarePrice: 69 };

describe("qualifiesForWelfare", () => {
  it("matches any of the product's chosen roles", () => {
    expect(qualifiesForWelfare({ welfareRoles: ["smo", "anusmo"] }, ["anusmo"])).toBe(true);
    expect(qualifiesForWelfare({ welfareRoles: ["smo"] }, ["student", "smo"])).toBe(true);
  });

  it("does not match roles that were not chosen", () => {
    expect(qualifiesForWelfare({ welfareRoles: ["smo"] }, ["student"])).toBe(false);
    expect(qualifiesForWelfare({ welfareRoles: ["smo"] }, ["admin", "super_admin"])).toBe(false);
    expect(qualifiesForWelfare({ welfareRoles: [] }, ["smo"])).toBe(false);
    expect(qualifiesForWelfare({ welfareRoles: null }, ["smo"])).toBe(false);
    expect(qualifiesForWelfare({ welfareRoles: ["smo"] }, null)).toBe(false);
  });
});

describe("per-option welfare price", () => {
  it("prices each option on its own", () => {
    expect(effectiveUnitPrice(product, opt1, ["smo"])).toBe(29);
    expect(effectiveUnitPrice(product, opt2, ["smo"])).toBe(69);
  });

  it("charges everyone else the normal option prices", () => {
    expect(effectiveUnitPrice(product, opt1, ["student"])).toBe(39);
    expect(effectiveUnitPrice(product, opt2, ["student"])).toBe(89);
    expect(normalUnitPrice(product, opt2)).toBe(89);
  });

  it("lets one option have welfare while another does not", () => {
    const noWelfare = { priceDelta: 50, welfarePrice: null };
    expect(effectiveUnitPrice(product, opt1, ["smo"])).toBe(29);
    expect(effectiveUnitPrice(product, noWelfare, ["smo"])).toBe(89);
  });

  it("falls back to the product-level welfare base plus the surcharge", () => {
    const legacy = { price: 39, welfarePrice: 29, welfareRoles: ["smo"] };
    expect(effectiveUnitPrice(legacy, { priceDelta: 0 }, ["smo"])).toBe(29);
    expect(effectiveUnitPrice(legacy, { priceDelta: 50 }, ["smo"])).toBe(79);
  });

  it("prefers the option's own price over the product-level base", () => {
    const both = { price: 39, welfarePrice: 29, welfareRoles: ["smo"] };
    expect(effectiveUnitPrice(both, { priceDelta: 50, welfarePrice: 60 }, ["smo"])).toBe(60);
  });

  it("is off without roles or a price", () => {
    expect(welfareUnitPrice({ price: 39, welfareRoles: [] }, opt1)).toBeNull();
    expect(welfareUnitPrice(product, { priceDelta: 0, welfarePrice: null })).toBeNull();
    expect(hasWelfare(product, [{ priceDelta: 0 }])).toBe(false);
    expect(hasWelfare(product, [opt1, { priceDelta: 50 }])).toBe(true);
  });

  it("never raises a price", () => {
    expect(effectiveUnitPrice(product, { priceDelta: 0, welfarePrice: 39 }, ["smo"])).toBe(39);
    expect(effectiveUnitPrice(product, { priceDelta: 0, welfarePrice: 99 }, ["smo"])).toBe(39);
  });

  it("allows a free welfare option", () => {
    expect(effectiveUnitPrice(product, { priceDelta: 0, welfarePrice: 0 }, ["smo"])).toBe(0);
  });
});

describe("bundle deals with welfare prices", () => {
  it("computes the discount off the buyer's welfare option prices", () => {
    const deals = { price: 39, bundleDeals: [{ qty: 3, price: 60 }] };
    const variants = [
      { id: "a", priceDelta: 0, unitPrice: 29 },
      { id: "b", priceDelta: 50, unitPrice: 69 },
    ];
    const qty = new Map([["a", 3]]);
    // 3 × ฿29 = ฿87 singles; the ฿60 deal saves ฿27.
    expect(computeBundleDiscount(deals, variants, qty)).toBe(27);
    // Same order priced normally: 3 × ฿39 = ฿117, deal saves ฿57.
    expect(computeBundleDiscount(deals, [{ id: "a", priceDelta: 0 }, { id: "b", priceDelta: 50 }], qty)).toBe(57);
  });

  it("never lets a welfare buyer pay more than a normal buyer", () => {
    const deals = { price: 39, bundleDeals: [{ qty: 3, price: 100 }] };
    const qty = new Map([["a", 3]]);
    const normal = 3 * 39 - computeBundleDiscount(deals, [{ id: "a", priceDelta: 0 }], qty);
    const welfare = 3 * 29 - computeBundleDiscount(deals, [{ id: "a", priceDelta: 0, unitPrice: 29 }], qty);
    expect(welfare).toBeLessThanOrEqual(normal);
  });
});
