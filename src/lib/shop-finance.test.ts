import { describe, it, expect } from "vitest";
import {
  allocateProportionally,
  financeStatus,
  orderBreakdown,
  summarizeByProduct,
  type FinanceOrder,
} from "@/lib/shop-finance";

describe("allocateProportionally", () => {
  it("splits in proportion and always sums to the amount", () => {
    expect(allocateProportionally(100, [100, 100])).toEqual([50, 50]);
    expect(allocateProportionally(10, [1, 1, 1])).toEqual([4, 3, 3]);
    const shares = allocateProportionally(37, [199, 350, 51]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(37);
  });
  it("handles zero amounts, zero weights, and no lines", () => {
    expect(allocateProportionally(0, [5, 5])).toEqual([0, 0]);
    expect(allocateProportionally(40, [0, 0])).toEqual([40, 0]);
    expect(allocateProportionally(40, [])).toEqual([]);
  });
});

describe("financeStatus", () => {
  it("treats anything but approved/rejected as pending", () => {
    expect(financeStatus("approved")).toBe("approved");
    expect(financeStatus("rejected")).toBe("rejected");
    expect(financeStatus("pending")).toBe("pending");
    expect(financeStatus("weird")).toBe("pending");
  });
});

describe("orderBreakdown", () => {
  it("derives the subtotal from the charged total", () => {
    expect(orderBreakdown({ totalAmount: 330, discountAmount: 20, shippingFee: 50 })).toEqual({
      subtotal: 300, discount: 20, shipping: 50, total: 330,
    });
  });
});

const shirt = { productId: "p-shirt", productName: "Shirt", unitPrice: 250, quantity: 1 };
const cap = { productId: "p-cap", productName: "Cap", unitPrice: 150, quantity: 1 };

describe("summarizeByProduct", () => {
  const orders: FinanceOrder[] = [
    { id: "o1", status: "approved", discountAmount: 0, shippingFee: 40, sellerName: null, items: [{ ...shirt, quantity: 2 }] },
    { id: "o2", status: "pending", discountAmount: 0, shippingFee: 0, sellerName: null, items: [shirt] },
    { id: "o3", status: "rejected", discountAmount: 0, shippingFee: 0, sellerName: null, items: [shirt] },
    // Mixed order: ฿400 gross, ฿40 discount and ฿80 shipping split 250:150.
    { id: "o4", status: "approved", discountAmount: 40, shippingFee: 80, sellerName: null, items: [shirt, cap] },
  ];

  it("groups money by product and status", () => {
    const { rows } = summarizeByProduct(orders);
    const s = rows.find((r) => r.productId === "p-shirt")!;
    expect(s.approved).toEqual({ orders: 2, units: 3, gross: 750, discount: 25, shipping: 90, net: 815 });
    expect(s.pending).toMatchObject({ orders: 1, units: 1, net: 250 });
    expect(s.rejected).toMatchObject({ orders: 1, units: 1, net: 250 });
    const c = rows.find((r) => r.productId === "p-cap")!;
    expect(c.approved).toEqual({ orders: 1, units: 1, gross: 150, discount: 15, shipping: 30, net: 165 });
  });

  it("totals count each order once and reconcile with order totals", () => {
    const { totals } = summarizeByProduct(orders);
    expect(totals.approved.orders).toBe(2);
    // o1 = 500 + 40; o4 = 400 − 40 + 80.
    expect(totals.approved.net).toBe(540 + 440);
  });

  it("a filtered view keeps the whole-order split", () => {
    const { rows, totals } = summarizeByProduct(orders, (l) => l.productId === "p-cap");
    expect(rows.map((r) => r.productId)).toEqual(["p-cap"]);
    expect(totals.approved.net).toBe(165);
  });

  it("groups lines of a deleted product by snapshot name", () => {
    const { rows } = summarizeByProduct([
      { id: "o5", status: "approved", discountAmount: 0, shippingFee: 0, sellerName: "Club A", items: [{ productId: null, productName: "Old tote", unitPrice: 90, quantity: 1 }] },
    ]);
    expect(rows[0]).toMatchObject({ key: "name:Old tote", productId: null, sellerName: "Club A" });
  });
});
