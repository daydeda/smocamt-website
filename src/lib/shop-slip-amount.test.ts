import { describe, expect, it } from "vitest";
import { classifySlipAmount, parseSlipAmounts } from "./shop-slip-amount";

describe("parseSlipAmounts", () => {
  it("reads money-formatted numbers as satang, with or without thousands commas", () => {
    expect(parseSlipAmounts("Amount 1,250.00 THB  Fee 0.00  Total 12,345.67")).toEqual([125000, 0, 1234567]);
    expect(parseSlipAmounts("จำนวนเงิน: 350.50 บาท")).toEqual([35050]);
  });

  it("ignores non-money numbers (refs, dates, times, account numbers, bad grouping)", () => {
    expect(parseSlipAmounts("Ref 202610190123456 19/10/2026 14:32 xxx-x-x1234-x 5.5 100 99.999 1.234.56")).toEqual([]);
  });

  it("de-duplicates repeated amounts (amount printed twice on a slip)", () => {
    expect(parseSlipAmounts("350.00 ... 350.00")).toEqual([35000]);
  });
});

describe("classifySlipAmount", () => {
  it("is clean when any amount on the slip equals the order total", () => {
    expect(classifySlipAmount(1250, [0, 125000])).toBeNull();
  });

  it("flags a mismatch when amounts were read but none is the total", () => {
    expect(classifySlipAmount(1250, [100000, 0])).toBe("amount_mismatch");
    expect(classifySlipAmount(1250, [125001])).toBe("amount_mismatch");
  });

  it("flags unreadable when OCR failed or found no amount, so silence always means a match", () => {
    expect(classifySlipAmount(1250, null)).toBe("amount_unreadable");
    expect(classifySlipAmount(1250, [])).toBe("amount_unreadable");
  });
});
