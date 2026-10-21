import { describe, it, expect } from "vitest";
import { computeBundleDiscount } from "@/lib/shop/shop-promotions";
import { applyWelfare, hasWelfarePrice, qualifiesForWelfare } from "@/lib/shop/shop-welfare";

const base = { price: 250, welfarePrice: 180, welfareRoles: ["smo"] };

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

describe("applyWelfare", () => {
  it("swaps in the welfare price for a qualifying buyer", () => {
    expect(applyWelfare(base, ["smo"]).price).toBe(180);
  });

  it("leaves the price alone for everyone else", () => {
    expect(applyWelfare(base, ["student"]).price).toBe(250);
  });

  it("is a no-op without a welfare price or without roles", () => {
    expect(applyWelfare({ ...base, welfarePrice: null }, ["smo"]).price).toBe(250);
    expect(applyWelfare({ ...base, welfareRoles: [] }, ["smo"]).price).toBe(250);
    expect(applyWelfare({ price: 250 }, ["smo"]).price).toBe(250);
  });

  it("never raises the price", () => {
    expect(applyWelfare({ ...base, welfarePrice: 300 }, ["smo"]).price).toBe(250);
    expect(hasWelfarePrice({ ...base, welfarePrice: 250 })).toBe(false);
  });

  it("allows a free welfare price", () => {
    expect(applyWelfare({ ...base, welfarePrice: 0 }, ["smo"]).price).toBe(0);
  });

  it("does not mutate the product", () => {
    applyWelfare(base, ["smo"]);
    expect(base.price).toBe(250);
  });

  it("keeps a welfare bundle order at or below the normal buyer's cost", () => {
    const product = { price: 150, welfarePrice: 120, welfareRoles: ["smo"], bundleDeals: [{ qty: 3, price: 300 }] };
    const variants = [{ id: "v", priceDelta: 0 }];
    const qty = new Map([["v", 3]]);
    const normal = 150 * 3 - computeBundleDiscount(product, variants, qty);
    const welfare = applyWelfare(product, ["smo"]);
    const smo = welfare.price * 3 - computeBundleDiscount(welfare, variants, qty);
    expect(normal).toBe(300);
    expect(smo).toBe(300);
    const weak = applyWelfare({ ...product, bundleDeals: [{ qty: 3, price: 400 }] }, ["smo"]);
    expect(weak.price * 3 - computeBundleDiscount(weak, variants, qty)).toBe(360);
  });
});
