import { pgTable, text, timestamp, uuid, integer, boolean, jsonb, bigserial, primaryKey, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";
import type { ShopCustomField, ShopCustomValue } from "@/lib/shop-custom-fields";
import type { ShopDeliveryTier } from "@/lib/shop-delivery";

export const houses = pgTable("houses", {
  // House id, e.g. 'red'. ActiveCAMT is CAMT-only (see src/lib/faculties.ts) so
  // this is always a bare colour id.
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").default("#6366f1"), // Hex color for display
  points: integer("points").notNull().default(0),
  // Always 'CAMT'. Kept (rather than dropped) from a since-reverted multi-faculty
  // migration meant for a separate project — see drizzle/0022_revert_four_faculty_houses.sql.
  faculty: text("faculty").notNull().default("CAMT"),
  // Same as `id` while faculty is single-valued; kept for the same reason as `faculty`.
  colorGroup: text("color_group").notNull().default("red"),
}, (table) => ([
  index("idx_houses_color_group").on(table.colorGroup),
  index("idx_houses_faculty").on(table.faculty),
]));

// Clubs are a DYNAMIC entity (created/renamed/retired over time by staff), unlike
// the fixed small set of houses — hence a uuid PK rather than a slug id. A club is
// never hard-deleted: archive it via isArchived so any events it already owns and
// its membership history survive. The partial unique index below keeps two ACTIVE
// clubs from sharing a name while letting a new club reuse an archived club's name.
export const clubs = pgTable("clubs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("clubs_active_name_unique").on(table.name).where(sql`${table.isArchived} = false`),
]));

// Many-to-many membership: a user may preside over / belong to multiple clubs, and
// a club has multiple members. `role` ('president' | 'member') is reserved now — the
// current feature only writes 'president' rows, but keeping the column lays the
// groundwork for a future per-club member-roster feature without a second migration.
export const clubMembers = pgTable("club_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  clubId: uuid("club_id").notNull().references(() => clubs.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"), // 'president' | 'member'
  // Per-club staff title (e.g. 'president', 'club_affairs') from src/lib/positions.ts.
  // The per-club analogue of the (now-legacy) `users.position` — distinct from this
  // row's own `role` ('member' | 'president'), which is about system membership tier.
  position: text("position"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("club_members_club_user_unique").on(table.clubId, table.userId),
  index("club_members_user_idx").on(table.userId),
  index("club_members_club_idx").on(table.clubId),
]));

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Auth.js / OAuth provider ID
  prefix: text("prefix"),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date", withTimezone: true }),
  image: text("image"),
  role: text("role").default("student"), // 'student', 'smo', 'anusmo', 'club_president', 'major_president', 'admin', 'registration', 'organizer', 'super_admin'
  roles: jsonb("roles").$type<string[]>().default(["student"]),
  houseId: text("house_id").references(() => houses.id),
  points: integer("points").notNull().default(0),
  // No-show strike-out: counts confirmed no-show strikes (registered but never
  // checked in). At 3 strikes, registrationBlocked flips to true, preventing
  // new event pre-registration until a staff member resets it.
  noShowCount: integer("no_show_count").notNull().default(0),
  registrationBlocked: boolean("registration_blocked").notNull().default(false),
  // QR Token for secure check-in (FE-13)
  qrToken: text("qr_token").unique(),
  // Profile specifics
  studentId: text("student_id").unique(),
  nickname: text("nickname"),
  faculty: text("faculty"), // always 'CAMT' (null treated as CAMT too) — see src/lib/faculties.ts
  major: text("major"), // major code, e.g. ANI, DG, DII, MMIT, SE
  // LEGACY/DEPRECATED: used to store a single SMO/club/major title shared across
  // all three contexts (club membership, major team, SMO/ANUSMO), which silently
  // clobbered each other. Superseded by clubMembers.position, majorPosition,
  // smoPosition, and anusmoPosition below — no longer written. Kept (not dropped)
  // because migrations here must be non-destructive (see CLAUDE.md); dropping it
  // is a separate future cleanup once the new columns are verified in prod.
  position: text("position"),
  // Major-team staff title (e.g. 'president', 'secretary') from src/lib/positions.ts,
  // scoped to the user's one major. Replaces the legacy `position` column above.
  majorPosition: text("major_position"),
  // SMO staff title from src/lib/positions.ts, scoped to holding the 'smo' role.
  // A user can hold both smo and anusmo roles at once with different titles in each.
  smoPosition: text("smo_position"),
  // ANUSMO staff title from src/lib/positions.ts, scoped to holding the 'anusmo' role.
  // A user can hold both smo and anusmo roles at once with different titles in each.
  anusmoPosition: text("anusmo_position"),
  imageTransform: jsonb("image_transform"), // { scale: number, x: number, y: number }
  religion: text("religion"),
  phone: text("phone").unique(),
  contactChannels: text("contact_channels"),
  // Sensitive data (FE-12, §4.3)
  chronicDiseases: text("chronic_diseases"),
  medicalHistory: text("medical_history"),
  drugAllergies: text("drug_allergies"),
  foodAllergies: text("food_allergies"),
  dietaryRestrictions: text("dietary_restrictions"),
  faintingHistory: boolean("fainting_history"),
  emergencyMedication: text("emergency_medication"),
  emergencyContacts: jsonb("emergency_contacts"), // [{name, relationship, phone}]
  pdpaConsent: boolean("pdpa_consent").default(false),
  profileCompleted: boolean("profile_completed").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ([
  index("idx_users_profile_completed").on(table.profileCompleted),
  index("idx_users_house_id").on(table.houseId),
  // Role-filtered admin/leaderboard queries and signup-time ordering/reporting.
  index("idx_users_role").on(table.role),
  index("idx_users_created_at").on(table.createdAt),
]));

export const authenticators = pgTable(
  "authenticator",
  {
    credentialID: text("credentialID").notNull().unique(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerAccountId: text("providerAccountId").notNull(),
    credentialPublicKey: text("credentialPublicKey").notNull(),
    counter: integer("counter").notNull(),
    credentialDeviceType: text("credentialDeviceType").notNull(),
    credentialBackedUp: boolean("credentialBackedUp").notNull(),
    transports: text("transports"),
  }
);

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ([
    primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
    index("idx_account_userid").on(account.userId),
  ])
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
}, (table) => ([
  index("idx_session_userid").on(table.userId),
]));

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
);

export const events = pgTable("events", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  registrationOpenTime: timestamp("registration_open_time", { withTimezone: true }),
  registrationCloseTime: timestamp("registration_close_time", { withTimezone: true }),
  quota: integer("quota"),
  location: text("location"),
  // House points: awarded to the WINNING house (most distinct attendees) at
  // event-end. See award-points.ts checkAndAwardPastEventPoints.
  pointsAwarded: integer("points_awarded").default(0),
  // Individual points: awarded to EACH attendee, added to users.points the moment
  // a check-in becomes 'attended'. Per-day on multi-day events (each session
  // check-in awards again). See ScannerService.awardAttendanceIndividualPoints.
  individualPointsAwarded: integer("individual_points_awarded").default(0),
  // Cover poster — kept as the single source for thumbnails (admin list, etc.).
  // Always mirrors imageUrls[0] so legacy single-image consumers keep working.
  imageUrl: text("image_url"),
  // Ordered list of poster image URLs. First entry is the cover. Empty/NULL on
  // legacy events — read them as `imageUrls ?? (imageUrl ? [imageUrl] : [])`.
  imageUrls: jsonb("image_urls").$type<string[]>(),
  walkInsEnabled: boolean("walk_ins_enabled").default(false),
  // When true, pre-registration is refused entirely (see POST /api/events/[id]/
  // register) — students may only attend via a walk-in scan at the door.
  // Implies walkInsEnabled; the UI forces that toggle on together with this one.
  walkInsOnly: boolean("walk_ins_only").default(false),
  quotaWalkIn: integer("quota_walk_in"),
  // Multi-day / multi-session check-in. 'once' = student registers once at the
  // event level and that registration is attendable at any/all sessions.
  // 'per_session' = registration + walk-in quota are tracked independently per
  // session (walk-ins re-open each day). Single-session events use 'once' and
  // behave exactly as before. See docs/features/multi-day-checkin-implementation.md.
  registrationMode: text("registration_mode").$type<"once" | "per_session">().notNull().default("once"),
  targetThai: boolean("target_thai").default(true),
  targetInternational: boolean("target_international").default(true),
  quotaThai: integer("quota_thai"),
  quotaInternational: integer("quota_international"),
  // Role-based access control: which roles can see/register for this event
  // null or [] means all roles can access; otherwise restricted to listed roles
  // Possible values: 'student', 'staff', 'smo', 'anusmo', 'club_president',
  // 'major_president' (admin roles always see everything)
  allowedRoles: jsonb("allowed_roles").$type<string[]>(),
  // Which president role(s) MANAGE this event (club_president / major_president):
  // controls whether they see it in their admin events list, can view
  // attendance, scan, and export. This is SEPARATE from allowedRoles, which
  // controls participant (student) visibility/registration. Empty/null = not
  // president-managed (only staff manage it).
  managedByRoles: jsonb("managed_by_roles").$type<string[]>(),
  // Major-based access control: which student majors can see/register for this
  // event. null or [] means all majors; otherwise restricted to the listed
  // majors (ANI, DG, DII, MMIT, SE). Combined with allowedRoles as AND — a user
  // must satisfy both. Admin roles always bypass.
  allowedMajors: jsonb("allowed_majors").$type<string[]>(),
  // Club-based access control (participant eligibility, SEPARATE from ownerClubIds
  // below, which controls who MANAGES the event): which club(s) a student must
  // belong to (via club_members, ANY role — 'member' or 'president') to see/register
  // for this event. Club UUIDs (as strings) referencing clubs.id. null or [] means
  // no club restriction — open to everyone. Combined with allowedRoles/allowedMajors
  // as AND — a user must satisfy all set restrictions. Admin roles always bypass
  // (bypass logic lives in application code, not here). Mirrors the allowedMajors
  // jsonb string[] pattern above.
  allowedClubs: jsonb("allowed_clubs").$type<string[]>(),
  // President ownership scope (SEPARATE from managedByRoles, which only answers "is
  // a president role involved at all"). These answer "president of WHICH club/major":
  //   ownerClubIds — club UUIDs (as strings) that own this event; a club_president
  //     manages it only if they preside over one of these clubs.
  //   ownerMajors  — major strings (ANI/DG/DII/MMIT/SE) that own this event; a
  //     major_president manages it only if their users.major is listed.
  // Both nullable: null/[] means NO owner assigned yet, which the scoping logic
  // treats as "hidden from all presidents until staff assigns one" (staff/admin
  // always bypass). Mirrors the allowedMajors jsonb string[] pattern above.
  ownerClubIds: jsonb("owner_club_ids").$type<string[]>(),
  ownerMajors: jsonb("owner_majors").$type<string[]>(),
  // Details auto-re-review: a president's edit is NEVER blocked (see PUT
  // /api/admin/events/[id]) — but any edit by a president always resets this
  // back to 'pending', so staff re-reviews it before it counts as approved
  // again. Staff themselves always write 'approved' (self-reviewed on the
  // spot). Default 'pending' is deliberate (unlike forms.reviewStatus's
  // 'approved' default): it preserves today's "president can always edit
  // their owned event's details" behavior for every existing event — nothing
  // retroactively flags; re-review only starts once a president actually edits.
  detailsReviewStatus: text("details_review_status").notNull().default("pending"), // 'pending' | 'approved'
  detailsReviewedBy: text("details_reviewed_by"), // no FK — mirrors noShowAppeals.reviewedBy
  detailsReviewedAt: timestamp("details_reviewed_at", { withTimezone: true }),
  // Pending edit proposal: a club/major president's edit to an EXISTING event's
  // details (title/dates/quota/etc.) is no longer applied live — it's held here
  // until staff approve or discard it. The live event columns above are never
  // touched by a president's edit anymore; this JSON blob is the only place
  // their submitted values live until approval.
  pendingDetailsChanges: jsonb("pending_details_changes").$type<Record<string, unknown>>(),
  pendingDetailsSubmittedBy: text("pending_details_submitted_by"), // no FK — mirrors detailsReviewedBy's no-FK pattern
  pendingDetailsSubmittedAt: timestamp("pending_details_submitted_at", { withTimezone: true }),
  // Explicit event-staff roster: user ids assigned to staff THIS event (distinct
  // from managedByRoles/ownerClubIds/ownerMajors, which answer "who MANAGES the
  // event configuration" — this answers "who is working it on the ground", e.g.
  // scanning/checking people in). Nullable/no default, matching the
  // allowedRoles/managedByRoles/ownerClubIds/ownerMajors jsonb string[] pattern.
  // null/[] = no explicit staff assigned.
  staffUserIds: jsonb("staff_user_ids").$type<string[]>(),
  // When true, only FIRST-YEAR students may see/register for this event — derived
  // from the student-id prefix (CMU Buddhist-era admission year, e.g. ids starting
  // with "69" for the 2026 intake). The current first-year prefix is computed at
  // runtime in src/lib/event-access.ts (currentFirstYearPrefix). Admin roles bypass.
  firstYearOnly: boolean("first_year_only").notNull().default(false),
  // Set once the event-winner house bonus has been awarded. This is the single
  // source of truth for "already processed" — never infer it from score_history,
  // because mid-event individual/milestone/manual rows also carry this eventId.
  winnerAwardedAt: timestamp("winner_awarded_at", { withTimezone: true }),
  // "Also count for Songsue" staff toggle — when true, this event's metadata and
  // registration/attendance status are mirrored one-directionally into the
  // sibling Songsue app via src/lib/songsue-sync.ts, so Songsue's own
  // house-points system can credit the right house. Songsue owns nothing about
  // this event; ActiveCAMT remains the single source of truth for creation,
  // registration, quota, and check-in.
  songsueLinked: boolean("songsue_linked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// A session is one occurrence of an event — typically a day (CAMT LINK Day 1 /
// Day 2), but could be a morning/afternoon block. "Day N" is just the Nth session
// ordered by sortOrder (ties by startTime); there is no separate "day" column.
// Every event has at least one session; a legacy single-day event has exactly one.
// quotaWalkIn here is the PER-SESSION walk-in sub-cap (walk-ins re-open each day).
export const eventSessions = pgTable("event_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }).notNull(),
  title: text("title"), // optional label e.g. "Day 1"; null → derive "Day N" in the UI
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  quotaWalkIn: integer("quota_walk_in"), // per-session walk-in sub-cap
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ([
  index("idx_event_sessions_event").on(table.eventId),
  index("idx_event_sessions_event_order").on(table.eventId, table.sortOrder),
]));

export const attendance = pgTable("attendance", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }).notNull(),
  // The precise check-in key. eventId is kept denormalized alongside it because
  // report/export/winner-bonus paths roll up by event; sessionId is always
  // derived-consistent with eventId on insert.
  sessionId: uuid("session_id").references(() => eventSessions.id, { onDelete: "cascade" }).notNull(),
  studentId: text("student_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  checkInTime: timestamp("check_in_time", { withTimezone: true }),
  method: text("method"), // 'qr', 'manual', 'walk-in', 'pre-registered'
  status: text("status").default("registered"), // 'registered', 'attended'
  scannedBy: text("scanned_by").references(() => users.id, { onDelete: "set null" }),
  medsCheckOption: text("meds_check_option"),
  // Snapshot (at insert time) of whether this student was on the event's
  // staffUserIds list when they registered/checked in — used to exempt staff
  // from quota counts and no-show strikes. Deliberately NOT re-derived later if
  // events.staffUserIds subsequently changes (historical accuracy for
  // already-recorded attendance rows).
  isStaff: boolean("is_staff").notNull().default(false),
}, (table) => ([
  // One row per student per SESSION. For a single-session 'once' event this is
  // behaviourally identical to the old (event_id, student_id) uniqueness.
  uniqueIndex("idx_attendance_session_student").on(table.sessionId, table.studentId),
  index("idx_attendance_event_student").on(table.eventId, table.studentId),
  index("idx_attendance_student").on(table.studentId),
  index("idx_attendance_checkin_time").on(table.checkInTime),
  // Attendee/head-count roll-ups filter by event AND status (registered/attended).
  index("idx_attendance_event_status").on(table.eventId, table.status),
]));

// Score history log per house per activity (FE-08)
export const scoreHistory = pgTable("score_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Nullable: an event/form that ends with no real award (no attendance, all
  // attendees unassigned, or 0 points configured) records a house-less activity
  // row — it shows in the Recent Activity feed but is attributed to no house.
  houseId: text("house_id").references(() => houses.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
  // The specific form whose contest award produced this row, when applicable.
  // Lets a re-opened form precisely revert ITS OWN award — other rows that share
  // the same eventId (scans, manual edits, the event-winner bonus) are untouched.
  // Null for non-form rows. SET NULL on form delete so the ledger entry survives.
  formId: uuid("form_id").references(() => forms.id, { onDelete: "set null" }),
  delta: integer("delta").notNull(), // positive = gain, negative = loss
  reason: text("reason").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow(),
}, (table) => ([
  index("idx_score_history_event").on(table.eventId),
  // Lets revertFormAward() find a single form's award rows without scanning.
  index("idx_score_history_form").on(table.formId),
  // Leaderboard recent-activity and the dashboard both ORDER BY timestamp DESC;
  // without this they degrade to a full sort as score_history grows (one row per scan/award).
  index("idx_score_history_timestamp").on(table.timestamp),
]));

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow(),
  // Monotonic insertion-order tiebreaker for the hash chain. Appends are
  // serialized by an advisory lock, but two can still land in the same
  // millisecond — `timestamp` then can't deterministically order them, which
  // forks the chain on tip selection (ORDER BY ... DESC LIMIT 1) and raises false
  // tamper alarms during verification (ORDER BY ... ASC). `seq` is a strictly
  // increasing bigint backed by its own sequence (bigserial), DB-assigned via
  // nextval on insert — the app never sets it. Order the chain by `seq` instead.
  seq: bigserial("seq", { mode: "number" }).notNull(),
  // Deliberately NO foreign keys to users.id: actor_id/target_id are baked into
  // the tamper-evident row hashes, so they must survive user deletion unchanged
  // (ON DELETE SET NULL would rewrite rows and break the chain).
  actorId: text("actor_id"),
  targetId: text("target_id"),
  action: text("action").notNull(),
  ipAddress: text("ip_address"),
  prevHash: text("prev_hash").notNull().default(""),
  rowHash: text("row_hash").notNull().default(""),
}, (table) => ([
  // Every append reads the chain tip via ORDER BY timestamp DESC LIMIT 1
  // (inside the advisory lock), and the admin page sorts by timestamp —
  // without this index both degrade to full-table sorts as the log grows.
  index("idx_audit_logs_timestamp").on(table.timestamp),
  // Deterministic chain ordering tiebreaker (see seq above): tip selection and
  // verification ORDER BY seq instead of the millisecond-granular timestamp.
  index("idx_audit_logs_seq").on(table.seq),
]));

// ─── Relations ────────────────────────────────────────────────────────────────

export const housesRelations = relations(houses, ({ many }) => ({
  users: many(users),
  scoreHistory: many(scoreHistory),
}));

export const clubsRelations = relations(clubs, ({ many }) => ({
  members: many(clubMembers),
}));

export const clubMembersRelations = relations(clubMembers, ({ one }) => ({
  club: one(clubs, {
    fields: [clubMembers.clubId],
    references: [clubs.id],
  }),
  user: one(users, {
    fields: [clubMembers.userId],
    references: [users.id],
  }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  house: one(houses, {
    fields: [users.houseId],
    references: [houses.id],
  }),
  attendances: many(attendance),
  clubMembers: many(clubMembers),
  auditLogsAsActor: many(auditLogs, { relationName: "actor" }),
  auditLogsAsTarget: many(auditLogs, { relationName: "target" }),
  gameRoomsAsHost: many(gameRooms, { relationName: "gameHost" }),
  gameRoomsAsGuest: many(gameRooms, { relationName: "gameGuest" }),
  gameRoomsAsWinner: many(gameRooms, { relationName: "gameWinner" }),
  gameStats: many(gameStats),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  sessions: many(eventSessions),
  attendances: many(attendance),
  scoreHistory: many(scoreHistory),
  pendingSubmitter: one(users, { fields: [events.pendingDetailsSubmittedBy], references: [users.id], relationName: "eventPendingDetailsSubmitter" }),
}));

export const eventSessionsRelations = relations(eventSessions, ({ one, many }) => ({
  event: one(events, {
    fields: [eventSessions.eventId],
    references: [events.id],
  }),
  attendances: many(attendance),
}));

export const attendanceRelations = relations(attendance, ({ one }) => ({
  event: one(events, {
    fields: [attendance.eventId],
    references: [events.id],
  }),
  session: one(eventSessions, {
    fields: [attendance.sessionId],
    references: [eventSessions.id],
  }),
  user: one(users, {
    fields: [attendance.studentId],
    references: [users.id],
  }),
  scanner: one(users, {
    fields: [attendance.scannedBy],
    references: [users.id],
  }),
}));

export const scoreHistoryRelations = relations(scoreHistory, ({ one }) => ({
  house: one(houses, {
    fields: [scoreHistory.houseId],
    references: [houses.id],
  }),
  event: one(events, {
    fields: [scoreHistory.eventId],
    references: [events.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, {
    fields: [auditLogs.actorId],
    references: [users.id],
    relationName: "actor",
  }),
  target: one(users, {
    fields: [auditLogs.targetId],
    references: [users.id],
    relationName: "target",
  }),
}));

export const forms = pgTable("forms", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }).notNull(),
  // 'K_pre' | 'K_post' | 'A' | 'S' — multiple forms of different types per event allowed
  formType: text("form_type").notNull().default("K_post"),
  sortOrder: integer("sort_order").notNull().default(0),
  title: text("title").notNull(),
  description: text("description"),
  questions: jsonb("questions").notNull(),
  // House points: awarded to the house with the most submissions when the form
  // closes (winner-take-all). See award-points.ts checkAndAwardClosedForms.
  pointsAwarded: integer("points_awarded").default(0),
  // Individual points: awarded to EACH student the moment they submit the form,
  // added to users.points. Independent of the house contest above; not clawed
  // back if the form re-opens. See POST /api/events/[id]/form.
  individualPointsAwarded: integer("individual_points_awarded").default(0),
  isActive: boolean("is_active").default(true),
  isAwarded: boolean("is_awarded").default(false),
  // Whether non-admin viewers (registration/organizer, later smo/club_president/major_president)
  // see respondent name/studentId/contact on submissions, vs a masked view; super_admin/admin
  // always see identity regardless (enforced in app code). Defaults false (anonymized) for every
  // form type — the creator opts in per form when identity is genuinely needed.
  showRespondentIdentity: boolean("show_respondent_identity").notNull().default(false),
  // Optional auto open/close window. NULL on either side = unbounded that side.
  // isActive stays the manual master override on top of this window.
  opensAt: timestamp("opens_at", { withTimezone: true }),
  closesAt: timestamp("closes_at", { withTimezone: true }),
  // Who may see/fill the form (used to gate S-Skill forms). Empty = only
  // super_admin/admin. A user qualifies if their role is in assignedRoles OR
  // their id is in assignedUserIds.
  assignedRoles: jsonb("assigned_roles").$type<string[]>().notNull().default([]),
  assignedUserIds: jsonb("assigned_user_ids").$type<string[]>().notNull().default([]),
  // Review gate for forms created/edited by club_president/major_president (who own
  // the event): staff (super_admin/admin/registration/organizer) edits are always
  // auto-approved, but a president's create/edit always resets reviewStatus to
  // 'pending' until staff explicitly approves it again. Default 'approved' is what
  // makes this backward-compatible — every form created before this review step
  // existed (all staff-created to date) is unaffected by this migration.
  reviewStatus: text("review_status").notNull().default("approved"), // 'pending' | 'approved'
  reviewedBy: text("reviewed_by"), // no FK — mirrors noShowAppeals.reviewedBy
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ([
  // Every "forms for this event" lookup filters by event_id; without this the
  // forms table (previously index-less) was full-scanned per event load.
  index("idx_forms_event_id").on(table.eventId),
]));

export const formSubmissions = pgTable("form_submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  formId: uuid("form_id").references(() => forms.id, { onDelete: "cascade" }).notNull(),
  studentId: text("student_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  answers: jsonb("answers").notNull(), // Map of questionId -> studentAnswer
  submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow(),
}, (table) => ([
  // One submission per student per form — blocks duplicate-submission point farming.
  uniqueIndex("idx_form_submissions_form_student").on(table.formId, table.studentId),
]));

export const formsRelations = relations(forms, ({ one, many }) => ({
  event: one(events, {
    fields: [forms.eventId],
    references: [events.id],
  }),
  submissions: many(formSubmissions),
}));

export const formSubmissionsRelations = relations(formSubmissions, ({ one }) => ({
  form: one(forms, {
    fields: [formSubmissions.formId],
    references: [forms.id],
  }),
  user: one(users, {
    fields: [formSubmissions.studentId],
    references: [users.id],
  }),
}));

// Dashboard announcement banner. Treated as a SINGLETON — the app always reads
// and writes the single most-recently-updated row (the editor upserts it). Body
// is plain text; newlines render via white-space: pre-wrap on the dashboard.
// updatedBy has no FK (like audit_logs) so editor deletion never rewrites it.
export const announcements = pgTable("announcements", {
  id: uuid("id").defaultRandom().primaryKey(),
  body: text("body").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ============================================================================
// SHOP / MERCH
// Lightweight store for selling merch (shirts, etc.). Flow: buyer places an order
// → transfers money (PromptPay/bank shown from shop_settings) → uploads a payment
// slip to a PRIVATE bucket → an admin reviews the slip and approves or rejects.
// ============================================================================

// Singleton settings (like announcements): payment instructions + QR shown to
// buyers at checkout, plus a master on/off switch for the whole shop.
export const shopSettings = pgTable("shop_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  // Rich-text (parseRichText markup) payment instructions / bank details.
  paymentInfo: text("payment_info").notNull().default(""),
  // Public URL (uploads bucket) of the PromptPay/bank QR image. Not sensitive.
  qrImageUrl: text("qr_image_url"),
  // Delivery / fulfillment (Phase 2). deliveryEnabled is the master on/off for
  // offering delivery at checkout. deliveryFee is the shop-wide FALLBACK fee (฿)
  // used only for products that don't set their own deliveryFee/deliveryTiers
  // (see shop_products); pickupInfo is the where/when-to-collect text for pickup.
  deliveryEnabled: boolean("delivery_enabled").notNull().default(false),
  deliveryFee: integer("delivery_fee").notNull().default(0),
  pickupInfo: text("pickup_info").notNull().default(""),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const shopProducts = pgTable("shop_products", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  // Rich-text description — same **bold** / [text](url) / {{color:#hex|text}}
  // markup as announcements, rendered through parseRichText().
  description: text("description").notNull().default(""),
  // Price in whole Thai Baht (฿). All variants of a product share this price.
  price: integer("price").notNull().default(0),
  // Cover poster — mirrors imageUrls[0]; kept for thumbnails / legacy reads.
  imageUrl: text("image_url"),
  // Ordered list of poster image URLs (carousel). Same pattern as events.imageUrls.
  imageUrls: jsonb("image_urls").$type<string[]>(),
  // Max units of THIS product one buyer may hold across all non-rejected orders.
  // NULL = unlimited. This is the per-buyer "limit per order" control.
  maxPerOrder: integer("max_per_order"),
  // Optional sale window. NULL on either side = unbounded that side. Outside the
  // window the product still shows but ordering is blocked (upcoming / closed).
  // isActive remains the manual master on/off on top of this schedule.
  opensAt: timestamp("opens_at", { withTimezone: true }),
  closesAt: timestamp("closes_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  // Audience targeting — mirrors events (shares src/lib/event-access.ts). Each
  // axis is AND-combined; an empty/NULL array = no restriction on that axis.
  // allowedRoles: only these roles see the product (empty = all roles).
  allowedRoles: jsonb("allowed_roles").$type<string[]>(),
  // allowedMajors: only these majors (ANI, DG, DII, MMIT, SE) see it (empty = all).
  allowedMajors: jsonb("allowed_majors").$type<string[]>(),
  // Thai / international student targeting (derived from student id). Both false
  // is treated as both true by the predicate. Shop admins always see everything.
  targetThai: boolean("target_thai").default(true),
  targetInternational: boolean("target_international").default(true),
  // Generic per-product personalization fields (e.g. jersey name/number). Array of
  // { key, label, type: text|number|select, required, maxLength|min|max|options }.
  // See src/lib/shop-custom-fields.ts. NULL/[] = no custom fields. Buyers' answers
  // are snapshotted onto shop_order_items.custom_values at checkout.
  customFields: jsonb("custom_fields").$type<ShopCustomField[]>(),
  // Per-product delivery pricing (overrides shop_settings.deliveryFee fallback).
  // deliveryFee = base ฿ fee (NULL = use the shop-wide fallback); deliveryTiers =
  // ascending quantity thresholds [{minQty,fee}] where the highest applicable
  // minQty wins ("order more than N → fee goes up"). An order's total shipping is
  // the SUM of each product's computed fee. See src/lib/shop-delivery.ts.
  deliveryFee: integer("delivery_fee"),
  deliveryTiers: jsonb("delivery_tiers").$type<ShopDeliveryTier[]>(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// A purchasable option of a product (e.g. size S/M/L). Every product has at least
// one variant; a simple item carries a single "Standard" variant. Stock lives
// here so each size has its own cap.
export const shopVariants = pgTable("shop_variants", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id").references(() => shopProducts.id, { onDelete: "cascade" }).notNull(),
  label: text("label").notNull(), // e.g. "S", "M", "L", "Standard", "Other"
  // Total units available for this variant. NULL = unlimited stock.
  stock: integer("stock"),
  // Price surcharge in whole ฿ added on top of the product's base price for this
  // variant — e.g. a special/oversized size (XXL, 3XL) that costs more. 0 = no
  // surcharge (the common case). The order line snapshots the resolved unit price
  // (product.price + priceDelta) at checkout, so later edits don't move old orders.
  priceDelta: integer("price_delta").notNull().default(0),
  // When true this is an "Other (specify)" option: the buyer must type a value,
  // which is appended to the snapshot label on their order line.
  allowCustom: boolean("allow_custom").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => ([
  index("idx_shop_variants_product").on(table.productId),
]));

export const shopOrders = pgTable("shop_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  buyerId: text("buyer_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  // 'pending' (awaiting review) | 'approved' | 'rejected'
  status: text("status").notNull().default("pending"),
  // Object path inside the PRIVATE "slips" bucket — NOT a public URL. The slip is
  // only ever served through the auth-guarded slip endpoint to the buyer or an
  // admin, never linked publicly (PDPA: slips carry names/bank details).
  slipPath: text("slip_path"),
  // Free/offline slip fraud pre-filter — NOT a bank-verified authenticity check.
  // sha256 hex digest of the uploaded slip image bytes, used to catch the same
  // physical slip photo being reused across multiple orders (duplicate-image check).
  slipHash: text("slip_hash"),
  // Raw string decoded from the QR code embedded in the slip image (usually the
  // issuing bank's own slip-verification URL). NULL if no QR code was detected.
  // Lets an admin one-tap open the bank's verification page instead of physically
  // re-scanning the photo.
  slipQrPayload: text("slip_qr_payload"),
  // NULL when the slip passed the automated pre-filter above, otherwise one of:
  // 'duplicate_image' | 'duplicate_qr' | 'no_qr'. Set at order-creation time by
  // comparing this order's slip against previously submitted slips.
  slipFlag: text("slip_flag"),
  // Snapshot of the order total (฿) at purchase time.
  totalAmount: integer("total_amount").notNull().default(0),
  // Optional buyer note (e.g. name on the slip, pickup preference).
  note: text("note"),
  // Fulfillment (Phase 2): 'pickup' (default) | 'delivery'. For delivery the buyer
  // supplies recipient name/phone/address (PDPA: personal data, shop-admin only)
  // and pays shippingFee (฿) — a snapshot of shop_settings.delivery_fee folded into
  // totalAmount at checkout. Pickup orders carry NULL recipient fields + fee 0.
  fulfillment: text("fulfillment").notNull().default("pickup"),
  recipientName: text("recipient_name"),
  recipientPhone: text("recipient_phone"),
  shippingAddress: text("shipping_address"),
  shippingFee: integer("shipping_fee").notNull().default(0),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ([
  index("idx_shop_orders_buyer").on(table.buyerId),
  index("idx_shop_orders_status").on(table.status),
  index("idx_shop_orders_slip_hash").on(table.slipHash),
  index("idx_shop_orders_slip_qr").on(table.slipQrPayload),
]));

export const shopOrderItems = pgTable("shop_order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").references(() => shopOrders.id, { onDelete: "cascade" }).notNull(),
  // Keep the order line even if the product/variant is later deleted (set null);
  // the snapshot columns below preserve what was actually bought.
  productId: uuid("product_id").references(() => shopProducts.id, { onDelete: "set null" }),
  variantId: uuid("variant_id").references(() => shopVariants.id, { onDelete: "set null" }),
  productName: text("product_name").notNull(),
  variantLabel: text("variant_label").notNull(),
  // Snapshot of the buyer's answers to the product's custom fields at checkout:
  // [{ label, value }] (self-describing, immune to later config edits). NULL = the
  // product had no custom fields / none were filled. See src/lib/shop-custom-fields.ts.
  customValues: jsonb("custom_values").$type<ShopCustomValue[]>(),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
}, (table) => ([
  index("idx_shop_order_items_order").on(table.orderId),
  index("idx_shop_order_items_product").on(table.productId),
  index("idx_shop_order_items_variant").on(table.variantId),
]));

export const shopProductsRelations = relations(shopProducts, ({ many }) => ({
  variants: many(shopVariants),
}));

export const shopVariantsRelations = relations(shopVariants, ({ one }) => ({
  product: one(shopProducts, {
    fields: [shopVariants.productId],
    references: [shopProducts.id],
  }),
}));

export const shopOrdersRelations = relations(shopOrders, ({ one, many }) => ({
  buyer: one(users, {
    fields: [shopOrders.buyerId],
    references: [users.id],
  }),
  items: many(shopOrderItems),
}));

export const shopOrderItemsRelations = relations(shopOrderItems, ({ one }) => ({
  order: one(shopOrders, {
    fields: [shopOrderItems.orderId],
    references: [shopOrders.id],
  }),
  product: one(shopProducts, {
    fields: [shopOrderItems.productId],
    references: [shopProducts.id],
  }),
  variant: one(shopVariants, {
    fields: [shopOrderItems.variantId],
    references: [shopVariants.id],
  }),
}));

// ============================================================================
// CALENDAR
// A calendar surface over events plus lightweight, calendar-only "entries"
// (deadlines, registration windows, "exam week"). Visibility columns mirror
// `events` EXACTLY so the same eligibility predicate (src/lib/event-access.ts)
// filters both. IMPORTANT: calendar_entries is NEVER read by the dashboard,
// scanner, attendance, or house-points paths — those query `events`/`attendance`
// only. Keep it that way so entries can't leak into participation/scoring.
// ============================================================================
export const calendarEntries = pgTable("calendar_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  // All-day annotation → rendered as an all-day block and emitted in .ics with
  // DTSTART;VALUE=DATE (no time/timezone).
  allDay: boolean("all_day").notNull().default(false),
  // Optional informational link to a real event. ON DELETE SET NULL so deleting
  // the event keeps the annotation (non-destructive). This link NEVER creates an
  // attendance/score row — it is display metadata only.
  eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
  // Visibility — identical semantics + nullability to events.*. null/[] = visible
  // to everyone eligible. Admin roles always bypass (see event-access.ts).
  allowedRoles: jsonb("allowed_roles").$type<string[]>(),
  allowedMajors: jsonb("allowed_majors").$type<string[]>(),
  targetThai: boolean("target_thai").default(true),
  targetInternational: boolean("target_international").default(true),
  // Recurrence rule: "none" | "daily" | "weekly" | "monthly". Until date caps the
  // series; null means the rule applies indefinitely (grid bounded by window anyway).
  recurrence: text("recurrence").notNull().default("none"),
  recurrenceUntil: timestamp("recurrence_until", { withTimezone: true }),
  // Creator user id, no FK (like audit_logs.actorId historically / announcements)
  // so creator deletion never blocks or cascades.
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => ([
  index("idx_calendar_entries_start").on(table.startTime),
  index("idx_calendar_entries_event").on(table.eventId),
]));

// Per-user secret token for the subscribe-able .ics feed. The token IS the auth
// for /api/calendar/feed/[token] (which never calls auth()), so it must be a
// STORED, revocable random secret — unlike the stateless HMAC qr-token, which
// can't be revoked. One active token per user (PK on userId); regenerate =
// overwrite the row, instantly killing the old URL.
export const calendarFeedTokens = pgTable("calendar_feed_tokens", {
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).primaryKey(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export const calendarEntriesRelations = relations(calendarEntries, ({ one }) => ({
  event: one(events, {
    fields: [calendarEntries.eventId],
    references: [events.id],
  }),
}));

export const calendarFeedTokensRelations = relations(calendarFeedTokens, ({ one }) => ({
  user: one(users, {
    fields: [calendarFeedTokens.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// RATE LIMIT
// Durable, Postgres-backed rate limiter — replaces an in-memory Map that reset
// on every deploy and didn't share state across instances. One row per limiter
// key: `count` is the number of hits in the current window, `expiresAt` is when
// that window resets. A sweeper deletes expired rows using the expires_at index.
// No FKs / relations — it's cross-cutting infrastructure.
// ============================================================================
export const rateLimit = pgTable("rate_limit", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ([
  index("idx_rate_limit_expires_at").on(table.expiresAt),
]));

// ============================================================================
// P2P GAME ARENA
// gameRooms, webrtcSignals, and gameStats for the P2P OX game battle system.
// ============================================================================
export const gameRooms = pgTable("game_rooms", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomCode: text("room_code").notNull(),
  gameType: text("game_type").notNull(),
  hostId: text("host_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  guestId: text("guest_id").references(() => users.id, { onDelete: "cascade" }),
  gameState: jsonb("game_state").notNull(),
  currentTurn: integer("current_turn").notNull().default(1),
  status: text("status").notNull().default("waiting"),
  winnerId: text("winner_id").references(() => users.id, { onDelete: "set null" }),
  finishReason: text("finish_reason"),
  turnDeadline: timestamp("turn_deadline", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ([
  index("idx_game_rooms_code").on(table.roomCode),
  index("idx_game_rooms_status").on(table.status),
]));

export const webrtcSignals = pgTable("webrtc_signals", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomId: uuid("room_id").notNull().references(() => gameRooms.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  sdpOffer: text("sdp_offer"),
  sdpAnswer: text("sdp_answer"),
  iceCandidates: jsonb("ice_candidates").default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ([
  uniqueIndex("idx_webrtc_signals_room_role").on(table.roomId, table.role),
]));

export const gameStats = pgTable("game_stats", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  gameType: text("game_type").notNull(),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  draws: integer("draws").notNull().default(0),
  winStreak: integer("win_streak").notNull().default(0),
  bestStreak: integer("best_streak").notNull().default(0),
  totalGames: integer("total_games").notNull().default(0),
  lastPlayedAt: timestamp("last_played_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ([
  uniqueIndex("idx_game_stats_user_game").on(table.userId, table.gameType),
]));

export const gameRoomsRelations = relations(gameRooms, ({ one, many }) => ({
  host: one(users, {
    fields: [gameRooms.hostId],
    references: [users.id],
    relationName: "gameHost",
  }),
  guest: one(users, {
    fields: [gameRooms.guestId],
    references: [users.id],
    relationName: "gameGuest",
  }),
  winner: one(users, {
    fields: [gameRooms.winnerId],
    references: [users.id],
    relationName: "gameWinner",
  }),
  webrtcSignals: many(webrtcSignals),
}));

export const webrtcSignalsRelations = relations(webrtcSignals, ({ one }) => ({
  room: one(gameRooms, {
    fields: [webrtcSignals.roomId],
    references: [gameRooms.id],
  }),
}));

export const gameStatsRelations = relations(gameStats, ({ one }) => ({
  user: one(users, {
    fields: [gameStats.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// NO-SHOW APPEALS
// A student appeals ONE specific no-show event at a time (eventId), instead of
// only ever waiting on a manual staff reset (see .../strikes/reset/route.ts) or
// filing one blanket appeal that would clear every strike on the account.
// Approving an appeal only undoes THAT event's strike — decrements
// users.noShowCount by 1 and flips that event's attendance row(s) from
// 'no_show' to 'excused' (see api/admin/appeals/[id]/route.ts) — leaving any
// other, separately-earned strikes untouched. A student can therefore have
// several pending appeals open at once, one per no-show event.
// noShowCountAtAppeal snapshots the strike count at submission time so an
// admin reviewing later sees the context even if the count has since changed.
// eventId is nullable only so the column addition stays additive/non-destructive
// against any pre-existing rows; every new appeal is required to set it.
// ============================================================================
export const noShowAppeals = pgTable("no_show_appeals", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  noShowCountAtAppeal: integer("no_show_count_at_appeal").notNull(),
  // 'pending' | 'approved' | 'rejected'
  status: text("status").notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ([
  index("no_show_appeals_user_idx").on(table.userId),
  index("no_show_appeals_status_idx").on(table.status),
  index("no_show_appeals_event_idx").on(table.eventId),
  // Prevents spam: a user may have only one pending appeal per EVENT open at
  // once (not one per account — a student with 2 strikes may appeal both
  // events concurrently). Once an appeal is approved/rejected they're free to
  // submit a new one for that same event if struck again.
  uniqueIndex("no_show_appeals_one_pending_per_user_event").on(table.userId, table.eventId).where(sql`${table.status} = 'pending'`),
]));

export const noShowAppealsRelations = relations(noShowAppeals, ({ one }) => ({
  user: one(users, {
    fields: [noShowAppeals.userId],
    references: [users.id],
    relationName: "appealStudent",
  }),
  event: one(events, {
    fields: [noShowAppeals.eventId],
    references: [events.id],
  }),
  reviewer: one(users, {
    fields: [noShowAppeals.reviewedBy],
    references: [users.id],
    relationName: "appealReviewer",
  }),
}));

// ============================================================================
// ANONYMOUS FEEDBACK & COMPLAINTS
// See docs/features/feedback-complaints.md (§5 especially) for the full design
// rationale. This table's whole point is that submitter identity is NOT just
// role-masked (like forms.showRespondentIdentity or the president medical-detail
// carve-out) — it's architecturally absent. There is deliberately no FK back to
// `users`, and no admin break-glass unmask feature.
//
// Status/reply is checked via GET /api/feedback/mine (self-service, matched
// against the CALLER's own re-derived submitterRef) — there used to also be a
// one-time tracking-code lookup path, dropped 2026-08-13 (§7.0/§8) once the
// self-service path made it redundant and it was adding real UX/complexity
// cost (a code to save, a public no-auth lookup route) for no anonymity
// benefit beyond what login-gated submission already required.
//
// category: 'event' | 'staff_conduct' | 'harassment_safety' | 'house_points' |
// 'shop_order' | 'technical' | 'facility' | 'other' — validated in app code via
// Zod, not a DB enum (same convention as forms.formType / noShowAppeals.status).
//
// severity: 'low' | 'normal' | 'urgent'. Each category has a default severity
// (see docs §4) that only admins may downgrade, and a downgrade gets audit-logged.
//
// contactInfo: only meaningful when contactOptIn is true. This is a voluntary,
// purpose-limited disclosure (e.g. a Line ID/email typed in for follow-up) —
// categorically different from the submitter-identity withholding below; it is
// NOT submitter identity, just a contact channel the reporter chose to share.
//
// attachmentKeys: private-bucket storage keys, same storage pattern as
// form_submissions file uploads (form-file-storage.ts).
//
// submitterRef: HMAC-SHA256(userId, a server-only secret — FEEDBACK_HMAC_SECRET,
// never committed). Deliberately NOT a `references(() => users.id)` FK and
// deliberately not named/commented in a way that implies it's directly joinable
// to a user. It exists to support (a) abuse-control equality queries ("has this
// account submitted N times today") and (b) the submitter's own self-service
// lookup (GET /api/feedback/mine, computed from THEIR OWN session — never a
// client-supplied id). It is NOT reversible to a userId without the secret by
// anyone else — not through the app, and not for a human with raw DB access
// either. Application code must NEVER select/return this column in any
// admin-facing API response; enforce that via a narrow column allowlist in the
// query, not by convention alone. Unlike forms.showRespondentIdentity (a
// role-based UI mask on top of a raw FK, visible to super_admin), anonymity
// here is architectural — there is no in-app unmask path for any role,
// including super_admin.
//
// status: 'new' | 'in_review' | 'resolved' | 'closed'. 'closed' is reachable
// two ways: staff set it directly, OR the submitter closes their own
// 'resolved' complaint themselves (PATCH /api/feedback/mine/[id], ownership-
// checked via submitterRef, resolved->closed only — deliberately NOT
// audit-logged, see FeedbackService.closeMine's comment for why logging
// a submitter's own userId against this row would itself be a re-
// identification leak via /admin/audit-logs). Closed rows are kept, not
// deleted — they're the submitter's own history (docs §7.0). A closed
// complaint is final — no more messages can be posted to it either.
//
// The original single adminReply/repliedBy/repliedAt fields (one-shot
// staff reply) were replaced 2026-08-13 by feedbackComplaintMessages below,
// a proper two-way thread — staff sometimes need to ask a follow-up
// question, and a single reply field can't hold a back-and-forth.
// ============================================================================
export const feedbackComplaints = pgTable("feedback_complaints", {
  id: uuid("id").defaultRandom().primaryKey(),
  category: text("category").notNull(),
  severity: text("severity").notNull().default("normal"),
  message: text("message").notNull(),
  // Voluntary, purpose-limited follow-up contact channel — only meaningful
  // when contactOptIn is true. Populated either from a manually-typed value
  // (Line ID, a different email, etc.) or, if the submitter chooses to, from
  // their OWN ActiveCAMT account email (server-derived from their session at
  // submit time — see POST /api/feedback — never a value the client can set
  // on someone else's behalf). Either way this is an ACTIVE, EXPLICIT choice
  // the submitter makes (contactOptIn defaults false) — categorically
  // different from the submitter-identity withholding below (submitterRef);
  // it is NOT submitter identity, just a channel the reporter chose to share
  // specifically so staff can follow up.
  contactOptIn: boolean("contact_opt_in").notNull().default(false),
  contactInfo: text("contact_info"),
  attachmentKeys: jsonb("attachment_keys").$type<string[]>().notNull().default([]),
  // Keyed-hash abuse-control + self-service-lookup reference — NOT reversible
  // to a userId without the app-only secret. NEVER select/return this in
  // admin-facing responses. See the table-level comment above and
  // docs/features/feedback-complaints.md §5.
  submitterRef: text("submitter_ref").notNull(),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ([
  index("feedback_complaints_submitter_ref_idx").on(table.submitterRef),
  index("feedback_complaints_status_idx").on(table.status),
  index("feedback_complaints_category_idx").on(table.category),
]));

export const feedbackComplaintsRelations = relations(feedbackComplaints, ({ many }) => ({
  messages: many(feedbackComplaintMessages),
}));
// Still no relation to `users` — that absence is the anonymity guarantee
// itself, not an oversight (see the table-level comment above).

// Two-way conversation on a complaint, replacing the old single adminReply
// field (see above). senderType: 'submitter' | 'staff'. staffUserId is set
// ONLY for staff messages, no FK (mirrors noShowAppeals.reviewedBy /
// feedbackComplaints' old repliedBy) — identifies STAFF, not the reporter,
// so it's fine to store plainly. A submitter message carries NO sender
// identity at all beyond the parent row's submitterRef (which this table
// doesn't even duplicate — ownership for a submitter's own message-post is
// checked by joining to the parent complaint's submitterRef, never stored
// again here).
export const feedbackComplaintMessages = pgTable("feedback_complaint_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  complaintId: uuid("complaint_id").notNull().references(() => feedbackComplaints.id, { onDelete: "cascade" }),
  senderType: text("sender_type").notNull(), // 'submitter' | 'staff'
  staffUserId: text("staff_user_id"), // no FK — see comment above
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ([
  index("feedback_complaint_messages_complaint_idx").on(table.complaintId),
]));

export const feedbackComplaintMessagesRelations = relations(feedbackComplaintMessages, ({ one }) => ({
  complaint: one(feedbackComplaints, {
    fields: [feedbackComplaintMessages.complaintId],
    references: [feedbackComplaints.id],
  }),
}));

// ============================================================================
// EVENT PROPOSALS (club-president feature)
// A club president proposes a candidate event; staff review and either approve
// (creating the real row in `events`) or reject/leave it withdrawn. Requested
// values (quota, etc.) are non-binding — staff sets pointsAwarded/allowedRoles/
// allowedMajors/managedByRoles/ownerClubIds/staffUserIds explicitly when
// creating the real event, mirroring the field-strip precedent for
// president-submitted edits in api/admin/events/[id]/route.ts.
// clubId cascades on delete: deleting a club deletes its proposal history (the
// append-only audit log already keeps a free-text trail independent of the row).
// reviewedBy intentionally has NO FK — mirrors noShowAppeals.reviewedBy above.
// resultingEventId is set only as a side effect of POST /api/admin/events{proposalId}
// approving the proposal; "set null" so a later hard-delete of the created event
// doesn't FK-block, and the proposal survives as a historical record.
// clubId/majorCode: exactly one of the two is set per proposal (club_president
// proposals set clubId, major_president proposals set majorCode) — enforced in
// application code (the POST handler), not a DB constraint, to keep this migration
// simple. clubId is nullable (rather than a NOT NULL FK) to allow major_president
// proposals, which have no club at all. majorCode is a fixed code string (ANI/DG/
// DII/MMIT/SE), no FK — majors aren't a table, mirroring events.ownerMajors above.
// ============================================================================
export const eventProposals = pgTable("event_proposals", {
  id: uuid("id").defaultRandom().primaryKey(),
  clubId: uuid("club_id").references(() => clubs.id, { onDelete: "cascade" }),
  majorCode: text("major_code"),
  proposedBy: text("proposed_by").notNull().references(() => users.id, { onDelete: "cascade" }),

  title: text("title").notNull(),
  description: text("description"),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  registrationOpenTime: timestamp("registration_open_time", { withTimezone: true }),
  registrationCloseTime: timestamp("registration_close_time", { withTimezone: true }),
  location: text("location"),
  quota: integer("quota"),
  imageUrl: text("image_url"),
  imageUrls: jsonb("image_urls").$type<string[]>(),
  walkInsEnabled: boolean("walk_ins_enabled").default(false),
  walkInsOnly: boolean("walk_ins_only").default(false),
  quotaWalkIn: integer("quota_walk_in"),
  registrationMode: text("registration_mode").$type<"once" | "per_session">().notNull().default("once"),
  // Suggested multi-day schedule (mirrors eventSessions, but as plain jsonb —
  // proposals have no attendance to join against, so a real join table would be
  // pure overhead). Null/empty = single-day event; the top-level start/end above
  // cover it. Staff turns these into real eventSessions rows at conversion time.
  sessions: jsonb("sessions").$type<{ title: string | null; startTime: string; endTime: string }[]>(),
  targetThai: boolean("target_thai").default(true),
  targetInternational: boolean("target_international").default(true),
  quotaThai: integer("quota_thai"),
  quotaInternational: integer("quota_international"),
  firstYearOnly: boolean("first_year_only").default(false),
  // Suggested helpers only — from the proposer's OWN club roster (see
  // EventProposalsService/GET .../clubs/[id]/members), never the global
  // student directory. Staff can add/remove freely when creating the event.
  staffUserIds: jsonb("staff_user_ids").$type<string[]>(),
  // Suggested participant-eligibility ACL — mirrors events.allowedRoles/
  // allowedMajors/allowedClubs exactly (same "null/[] = no restriction"
  // convention). Non-binding, like every other field here: staff explicitly
  // reviews/adjusts these when creating the real event (see the fromProposal
  // prefill in admin/events/page.tsx) rather than them taking effect directly.
  allowedRoles: jsonb("allowed_roles").$type<string[]>(),
  allowedMajors: jsonb("allowed_majors").$type<string[]>(),
  allowedClubs: jsonb("allowed_clubs").$type<string[]>(),
  // Requested values only — non-binding. Staff sets pointsAwarded/
  // managedByRoles/ownerClubIds explicitly when creating the real
  // event, mirroring the field-strip precedent for president-submitted edits in
  // api/admin/events/[id]/route.ts.

  status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected' | 'withdrawn'
  reviewedBy: text("reviewed_by"), // no FK — mirrors noShowAppeals.reviewedBy
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
  // Set only as a side effect of POST /api/admin/events{proposalId}. "set null"
  // so a later hard-delete of the created event doesn't FK-block, and the
  // proposal survives as a historical record.
  resultingEventId: uuid("resulting_event_id").references(() => events.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ([
  index("event_proposals_club_idx").on(table.clubId),
  index("event_proposals_major_idx").on(table.majorCode),
  index("event_proposals_status_idx").on(table.status),
  index("event_proposals_proposed_by_idx").on(table.proposedBy),
]));

export const eventProposalsRelations = relations(eventProposals, ({ one }) => ({
  club: one(clubs, { fields: [eventProposals.clubId], references: [clubs.id] }),
  proposer: one(users, { fields: [eventProposals.proposedBy], references: [users.id], relationName: "proposalProposer" }),
  reviewer: one(users, { fields: [eventProposals.reviewedBy], references: [users.id], relationName: "proposalReviewer" }),
  resultingEvent: one(events, { fields: [eventProposals.resultingEventId], references: [events.id] }),
}));

