import { describe, expect, it } from "vitest";
import { loginHref, safeCallbackPath } from "./safe-callback-url";

describe("safeCallbackPath", () => {
  it("accepts same-site paths with query strings", () => {
    expect(safeCallbackPath("/dashboard/shop")).toBe("/dashboard/shop");
    expect(safeCallbackPath("/dashboard?event=abc")).toBe("/dashboard?event=abc");
  });

  it("rejects external, protocol-relative and scheme URLs", () => {
    for (const v of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "evil", ""]) {
      expect(safeCallbackPath(v)).toBeNull();
    }
  });

  it("rejects control characters and the login page itself", () => {
    expect(safeCallbackPath("/a\nb")).toBeNull();
    expect(safeCallbackPath("/login")).toBeNull();
    expect(safeCallbackPath("/login?callbackUrl=/x")).toBeNull();
  });

  it("handles null and undefined", () => {
    expect(safeCallbackPath(null)).toBeNull();
    expect(safeCallbackPath(undefined)).toBeNull();
  });
});

describe("loginHref", () => {
  it("encodes the return path", () => {
    expect(loginHref("/dashboard?event=abc")).toBe("/login?callbackUrl=%2Fdashboard%3Fevent%3Dabc");
  });

  it("falls back to plain /login for unsafe targets", () => {
    expect(loginHref("https://evil.example")).toBe("/login");
  });
});
