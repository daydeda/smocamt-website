// Types and constants shared by the club_president and major_president
// "propose an event" sections (admin/clubs/ProposeEventSection.tsx and
// admin/majors/MajorProposeEventSection.tsx).

// Suggested-access ACL options — mirrors admin/events/page.tsx's own
// ALL_PARTICIPANT_ROLES/ROLE_LABELS/ALL_MAJORS constants (kept as a local
// literal, like that file, rather than a shared import — these are UI-only
// label sets, not business logic). Entirely non-binding: staff reviews/adjusts
// before it ever takes effect (see the fromProposal prefill in
// admin/events/page.tsx).
export const ALL_PARTICIPANT_ROLES = ["student", "staff", "smo", "anusmo", "club_president", "major_president"] as const;
export type ParticipantRole = typeof ALL_PARTICIPANT_ROLES[number];
export const ROLE_LABELS: Record<ParticipantRole, string> = {
  student: "Student",
  staff: "Staff",
  smo: "SMO",
  anusmo: "ANUSMO",
  club_president: "Club President",
  major_president: "Major President",
};
export const ALL_MAJORS = ["ANI", "DG", "DII", "MMIT", "SE", "KIM", "DTM"] as const;

// A suggested extra day for a multi-day event — mirrors admin/events/page.tsx's
// SessionRow, minus `id`/`quotaWalkIn` (these are always brand-new suggestions;
// staff assigns per-day walk-in quotas at conversion, not the proposer).
export type ProposalSessionRow = { title: string; startTime: string; endTime: string };

// Fields every proposal has, whoever proposes it. The club and major sections
// each extend this with their own scope fields (club / majorCode).
export type ProposalBase = {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  registrationOpenTime: string | null;
  registrationCloseTime: string | null;
  location: string | null;
  quota: number | null;
  imageUrl: string | null;
  imageUrls: string[] | null;
  walkInsEnabled: boolean | null;
  walkInsOnly: boolean | null;
  quotaWalkIn: number | null;
  targetThai: boolean | null;
  targetInternational: boolean | null;
  quotaThai: number | null;
  quotaInternational: number | null;
  firstYearOnly: boolean | null;
  staffUserIds: string[] | null;
  allowedRoles: string[] | null;
  allowedMajors: string[] | null;
  sessions: { title: string | null; startTime: string; endTime: string }[] | null;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  reviewNote: string | null;
  createdAt: string;
  proposer: { id: string; name: string; studentId: string | null };
};

export const EMPTY_FORM_BASE = {
  title: "",
  description: "",
  startTime: "",
  endTime: "",
  registrationOpenTime: "",
  registrationCloseTime: "",
  location: "",
  quota: "",
  imageUrls: [] as string[],
  walkInsEnabled: false,
  walkInsOnly: false,
  quotaWalkIn: "",
  targetThai: true,
  targetInternational: true,
  quotaThai: "",
  quotaInternational: "",
  firstYearOnly: false,
  staffUserIds: [] as string[],
  allowedRoles: [] as string[],
  allowedMajors: [] as string[],
};
