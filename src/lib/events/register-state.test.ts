import { describe, expect, it } from "vitest";
import { getRegisterState } from "./register-state";

const now = new Date("2026-11-01T10:00:00+07:00");
const future = "2026-11-05T18:00:00+07:00";
const past = "2026-10-20T18:00:00+07:00";

describe("getRegisterState", () => {
  it("offers registration for an open event", () => {
    const s = getRegisterState({ endTime: future }, now);
    expect(s).toEqual({ kind: "register", canCancel: true, waitlisted: false, blocked: false, greyed: false });
  });

  it("offers the waitlist once the quota is full, but treats a quota of 0 as unlimited", () => {
    expect(getRegisterState({ endTime: future, quota: 10, registeredCount: 10 }, now).kind).toBe("joinWaitlist");
    expect(getRegisterState({ endTime: future, quota: 0, registeredCount: 10 }, now).kind).toBe("register");
  });

  it("lets a registered student cancel until the registration window closes", () => {
    expect(getRegisterState({ endTime: future, isRegistered: true }, now)).toMatchObject({ kind: "registered", canCancel: true, blocked: false });
    const locked = getRegisterState({ endTime: future, isRegistered: true, registrationCloseTime: past }, now);
    expect(locked).toMatchObject({ kind: "registered", canCancel: false, blocked: true, greyed: true });
  });

  it("reports attended and ended for a registered student", () => {
    expect(getRegisterState({ endTime: future, isRegistered: true, attendanceStatus: "attended" }, now).kind).toBe("attended");
    expect(getRegisterState({ endTime: past, isRegistered: true }, now).kind).toBe("ended");
  });

  it("puts the waitlist ahead of the window states", () => {
    const s = getRegisterState({ endTime: future, waitlistPosition: 3, registrationCloseTime: past }, now);
    expect(s).toMatchObject({ kind: "waitlisted", waitlisted: true });
  });

  it("blocks sign-up before the window opens, after it closes, for walk-in-only and view-only events", () => {
    expect(getRegisterState({ endTime: future, registrationOpenTime: future }, now)).toMatchObject({ kind: "notYetOpen", blocked: true, greyed: false });
    expect(getRegisterState({ endTime: future, registrationCloseTime: past }, now)).toMatchObject({ kind: "closed", blocked: true, greyed: true });
    expect(getRegisterState({ endTime: future, walkInsOnly: true }, now)).toMatchObject({ kind: "walkInsOnly", blocked: true });
    expect(getRegisterState({ endTime: future, canRegister: false }, now)).toMatchObject({ kind: "viewOnly", blocked: true });
  });
});
