import { describe, expect, it } from "vitest";
import { toPublicEvent, type PublicEventSource } from "./public-event";

const base: PublicEventSource & Record<string, unknown> = {
  id: "e1",
  title: "Open day",
  description: "Come along",
  startTime: new Date("2026-11-01T02:00:00Z"),
  endTime: new Date("2026-11-01T05:00:00Z"),
  location: "Room 101",
  imageUrl: "/uploads/a.png",
  imageUrls: null,
  quota: 40,
  registrationOpenTime: null,
  registrationCloseTime: null,
  walkInsOnly: null,
  ownerClubIds: ["club-1"],
  pendingDetailsChanges: { title: "secret" },
  staffUserIds: ["staff-1"],
  allowedClubs: ["club-1"],
};

describe("toPublicEvent", () => {
  it("falls back to the legacy single image when imageUrls is empty", () => {
    expect(toPublicEvent(base, 3).imageUrls).toEqual(["/uploads/a.png"]);
  });

  it("prefers imageUrls when present", () => {
    const out = toPublicEvent({ ...base, imageUrls: ["/a.png", "/b.png"] }, 0);
    expect(out.imageUrls).toEqual(["/a.png", "/b.png"]);
  });

  it("never copies owner, pending-edit, staff or eligibility fields", () => {
    const out = toPublicEvent(base, 3) as unknown as Record<string, unknown>;
    for (const key of ["ownerClubIds", "pendingDetailsChanges", "staffUserIds", "allowedClubs", "imageUrl"]) {
      expect(out).not.toHaveProperty(key);
    }
  });

  it("serialises dates to ISO strings and carries the seat count", () => {
    const out = toPublicEvent(base, 7);
    expect(out.startTime).toBe("2026-11-01T02:00:00.000Z");
    expect(out.registeredCount).toBe(7);
    expect(out.walkInsOnly).toBe(false);
  });
});
