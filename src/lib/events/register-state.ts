// What a student's register action for an event looks like right now. Shared by
// the dashboard event card, the compact list row and the event details modal so
// their button states can't drift apart.

export type RegisterKind =
  | "attended"
  | "ended"
  | "registered"
  | "waitlisted"
  | "notYetOpen"
  | "closed"
  | "walkInsOnly"
  | "viewOnly"
  | "joinWaitlist"
  | "register";

export type RegisterStateInput = {
  endTime: string;
  isRegistered?: boolean;
  attendanceStatus?: string | null;
  registrationOpenTime?: string | null;
  registrationCloseTime?: string | null;
  walkInsOnly?: boolean;
  canRegister?: boolean;
  waitlistPosition?: number | null;
  quota?: number | null;
  registeredCount?: number;
};

export type RegisterState = {
  kind: RegisterKind;
  // A registered student may still cancel (event not over, not attended, window open).
  canCancel: boolean;
  // On the waitlist: the action leaves it, without the cancel confirmation.
  waitlisted: boolean;
  // The action can't be taken at all (ignoring an in-flight request).
  blocked: boolean;
  // Rendered in the muted "not available" style.
  greyed: boolean;
};

export function getRegisterState(e: RegisterStateInput, now: Date = new Date()): RegisterState {
  const isPastEvent = now > new Date(e.endTime);
  const isAttended = e.attendanceStatus === "attended";
  const regOpenAt = e.registrationOpenTime ? new Date(e.registrationOpenTime) : null;
  const regCloseAt = e.registrationCloseTime ? new Date(e.registrationCloseTime) : null;
  // Once the registration window closes the headcount locks in both
  // directions: no new sign-ups AND no cancellations.
  const regWindowClosed = !!regCloseAt && now > regCloseAt;
  const canCancel = !isPastEvent && !isAttended && !regWindowClosed;
  const registered = !!e.isRegistered;
  const notYetOpen = !registered && !!regOpenAt && now < regOpenAt;
  const regClosed = !registered && regWindowClosed;
  const walkInsOnlyMode = !registered && !!e.walkInsOnly;
  const viewOnlyMode = !registered && e.canRegister === false;
  const waitlisted = !registered && e.waitlistPosition != null;
  // A quota of 0 means unlimited, same as null.
  const isFull = e.quota != null && e.quota > 0 && (e.registeredCount ?? 0) >= e.quota;

  const kind: RegisterKind = registered
    ? isAttended ? "attended" : isPastEvent ? "ended" : "registered"
    : waitlisted ? "waitlisted"
    : notYetOpen ? "notYetOpen"
    : regClosed ? "closed"
    : walkInsOnlyMode ? "walkInsOnly"
    : viewOnlyMode ? "viewOnly"
    : isFull ? "joinWaitlist"
    : "register";

  return {
    kind,
    canCancel,
    waitlisted,
    blocked: (registered && !canCancel) || notYetOpen || regClosed || walkInsOnlyMode || viewOnlyMode,
    greyed: regClosed || walkInsOnlyMode || viewOnlyMode || (registered && !canCancel),
  };
}
