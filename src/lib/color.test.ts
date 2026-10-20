import { describe, expect, it } from "vitest";
import { alpha } from "./color";

describe("alpha", () => {
  it("mixes a hex colour with transparent", () => {
    expect(alpha("#ef4444", 0.12)).toBe("color-mix(in srgb, #ef4444 12%, transparent)");
  });

  it("works with palette tokens, unlike appended hex alpha digits", () => {
    expect(alpha("var(--red-500)", 0.25)).toBe("color-mix(in srgb, var(--red-500) 25%, transparent)");
  });

  it("keeps one decimal of precision for converted hex alpha", () => {
    // 0x10 / 255
    expect(alpha("#000", 16 / 255)).toBe("color-mix(in srgb, #000 6.3%, transparent)");
  });
});
