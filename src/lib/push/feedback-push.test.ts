import { describe, expect, it } from "vitest";
import { feedbackSubmitterPayload } from "./feedback-push";

describe("feedbackSubmitterPayload", () => {
  const id = "11111111-2222-3333-4444-555555555555";

  it("points at the submitter's own tracking page, one tag per complaint and kind", () => {
    const reply = feedbackSubmitterPayload("reply", id);
    const resolved = feedbackSubmitterPayload("resolved", id);
    expect(reply.url).toBe("/feedback/track");
    expect(resolved.url).toBe("/feedback/track");
    expect(reply.tag).toBe(`feedback-reply:${id}`);
    expect(resolved.tag).toBe(`feedback-resolved:${id}`);
  });

  it("is bilingual and never carries the category, message or reply text", () => {
    for (const kind of ["reply", "resolved"] as const) {
      const p = feedbackSubmitterPayload(kind, id);
      expect(p.title).toMatch(/[ก-๙]/);
      expect(p.title).toMatch(/[A-Za-z]/);
      expect(`${p.title} ${p.body}`).not.toMatch(/harassment|complaint|safety|urgent/i);
    }
  });
});
