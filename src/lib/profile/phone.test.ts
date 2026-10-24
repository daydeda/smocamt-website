import { describe, expect, it } from "vitest";
import { formatPhone, phoneDigits } from "./phone";

describe("phone formatting", () => {
  it("chunks 3-3-4 as the user types", () => {
    expect(formatPhone("")).toBe("");
    expect(formatPhone("081")).toBe("081");
    expect(formatPhone("0812")).toBe("081-2");
    expect(formatPhone("0812345")).toBe("081-234-5");
    expect(formatPhone("0812345678")).toBe("081-234-5678");
  });
  it("round-trips through digits and caps at 10", () => {
    expect(phoneDigits("081-234-5678")).toBe("0812345678");
    expect(phoneDigits("08123456789999")).toBe("0812345678");
    expect(formatPhone("081-234-5678")).toBe("081-234-5678");
  });
});
