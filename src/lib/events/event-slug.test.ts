import { describe, expect, it } from "vitest";
import { eventPath, normalizeShortSlug, parseEventRef, slugifyTitle } from "./event-slug";

const ID = "407097cc-d7b5-4a29-a4e7-ff2d56b65c86";

describe("event-slug", () => {
  it("slugifies ascii titles and falls back for non-latin ones", () => {
    expect(slugifyTitle("CISC Board Game #2!")).toBe("cisc-board-game-2");
    expect(slugifyTitle("กิจกรรมรับน้อง")).toBe("event");
    expect(slugifyTitle("a".repeat(80)).length).toBeLessThanOrEqual(40);
  });

  it("builds a short path ending in the id prefix", () => {
    expect(eventPath(ID, "Play Badminton #2")).toBe("/e/play-badminton-2-407097cc");
  });

  it("parses short refs, bare prefixes and full uuids", () => {
    expect(parseEventRef("play-badminton-2-407097cc")).toEqual({ kind: "prefix", prefix: "407097cc" });
    expect(parseEventRef("407097cc")).toEqual({ kind: "prefix", prefix: "407097cc" });
    expect(parseEventRef(ID)).toEqual({ kind: "id", id: ID });
    expect(parseEventRef("play-badminton")).toBeNull();
    expect(parseEventRef("x407097cc")).toBeNull();
  });

  it("prefers a custom link name in the path", () => {
    expect(eventPath(ID, "Play Badminton #2", "badminton-2026")).toBe("/e/badminton-2026");
  });

  it("validates custom link names", () => {
    expect(normalizeShortSlug("  Badminton-2026 ")).toEqual({ ok: true, slug: "badminton-2026" });
    expect(normalizeShortSlug("")).toEqual({ ok: true, slug: null });
    expect(normalizeShortSlug(null)).toEqual({ ok: true, slug: null });
    expect(normalizeShortSlug("ab")).toEqual({ ok: false, reason: "format" });
    expect(normalizeShortSlug("has space")).toEqual({ ok: false, reason: "format" });
    expect(normalizeShortSlug("double--dash")).toEqual({ ok: false, reason: "format" });
    expect(normalizeShortSlug("-lead")).toEqual({ ok: false, reason: "format" });
    expect(normalizeShortSlug("407097cc")).toEqual({ ok: false, reason: "format" });
    expect(normalizeShortSlug(ID)).toEqual({ ok: false, reason: "format" });
    expect(normalizeShortSlug("admin")).toEqual({ ok: false, reason: "reserved" });
  });
});
