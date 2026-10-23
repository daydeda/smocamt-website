import { describe, expect, it } from "vitest";
import { PUSH_TEST_TYPES, isPushTestType, pushTestLabel, pushTestPayload } from "./push-test-samples";

describe("push test samples", () => {
  it("has a complete payload for every type", () => {
    expect(PUSH_TEST_TYPES.length).toBeGreaterThan(5);
    for (const type of PUSH_TEST_TYPES) {
      const p = pushTestPayload(type);
      expect(p.title.startsWith("[Test]")).toBe(true);
      expect(p.body.length).toBeGreaterThan(0);
      expect(p.url.startsWith("/")).toBe(true);
      expect(p.tag?.startsWith("test:")).toBe(true);
      expect(pushTestLabel(type, "en").length).toBeGreaterThan(0);
      expect(pushTestLabel(type, "th").length).toBeGreaterThan(0);
    }
  });

  it("uses a unique tag per type so tests never collapse into each other", () => {
    const tags = PUSH_TEST_TYPES.map((t) => pushTestPayload(t).tag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("accepts only known type ids", () => {
    expect(isPushTestType("basic")).toBe(true);
    expect(isPushTestType("nope")).toBe(false);
    expect(isPushTestType("toString")).toBe(false);
    expect(isPushTestType(undefined)).toBe(false);
  });
});
