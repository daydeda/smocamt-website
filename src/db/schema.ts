import { pgTable, text, timestamp, uuid, integer, boolean, jsonb, primaryKey, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";

export const houses = pgTable("houses", {
  id: text("id").primaryKey(), // e.g. 'red', 'blue', 'green', 'yellow'
  name: text("name").notNull(),
  color: text("color").default("#6366f1"), // Hex color for display
  points: integer("points").notNull().default(0),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Auth.js / OAuth provider ID
  prefix: text("prefix"),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date", withTimezone: true }),
  image: text("image"),
  role: text("role").default("student"), // 'student', 'smo', 'anusmo', 'admin', 'registration', 'organizer', 'super_admin'
  roles: jsonb("roles").$type<string[]>().default(["student"]),
  houseId: text("house_id").references(() => houses.id),
  points: integer("points").notNull().default(0),
  // QR Token for secure check-in (FE-13)
  qrToken: text("qr_token").unique(),
  // Profile specifics
  studentId: text("student_id").unique(),
  nickname: text("nickname"),
  major: text("major"), // ANI, DG, DII, MMIT, SE
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
  pointsAwarded: integer("points_awarded").default(0),
  // Cover poster — kept as the single source for thumbnails (admin list, etc.).
  // Always mirrors imageUrls[0] so legacy single-image consumers keep working.
  imageUrl: text("image_url"),
  // Ordered list of poster image URLs. First entry is the cover. Empty/NULL on
  // legacy events — read them as `imageUrls ?? (imageUrl ? [imageUrl] : [])`.
  imageUrls: jsonb("image_urls").$type<string[]>(),
  walkInsEnabled: boolean("walk_ins_enabled").default(false),
  quotaWalkIn: integer("quota_walk_in"),
  targetThai: boolean("target_thai").default(true),
  targetInternational: boolean("target_international").default(true),
  quotaThai: integer("quota_thai"),
  quotaInternational: integer("quota_international"),
  // Role-based access control: which roles can see/register for this event
  // null or [] means all roles can access; otherwise restricted to listed roles
  // Possible values: 'student', 'smo', 'anusmo' (admin roles always see everything)
  allowedRoles: jsonb("allowed_roles").$type<string[]>(),
  // Set once the event-winner house bonus has been awarded. This is the single
  // source of truth for "already processed" — never infer it from score_history,
  // because mid-event individual/milestone/manual rows also carry this eventId.
  winnerAwardedAt: timestamp("winner_awarded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const attendance = pgTable("attendance", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }).notNull(),
  studentId: text("student_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  checkInTime: timestamp("check_in_time", { withTimezone: true }),
  method: text("method"), // 'qr', 'manual', 'walk-in', 'pre-registered'
  status: text("status").default("registered"), // 'registered', 'attended'
  scannedBy: text("scanned_by").references(() => users.id, { onDelete: "set null" }),
  medsCheckOption: text("meds_check_option"),
}, (table) => ([
  uniqueIndex("idx_attendance_event_student").on(table.eventId, table.studentId),
  index("idx_attendance_student").on(table.studentId),
  index("idx_attendance_checkin_time").on(table.checkInTime),
]));

// Score history log per house per activity (FE-08)
export const scoreHistory = pgTable("score_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  houseId: text("house_id").references(() => houses.id, { onDelete: "cascade" }).notNull(),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(), // positive = gain, negative = loss
  reason: text("reason").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow(),
}, (table) => ([
  index("idx_score_history_event").on(table.eventId),
]));

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow(),
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
]));

// ─── Relations ────────────────────────────────────────────────────────────────

export const housesRelations = relations(houses, ({ many }) => ({
  users: many(users),
  scoreHistory: many(scoreHistory),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  house: one(houses, {
    fields: [users.houseId],
    references: [houses.id],
  }),
  attendances: many(attendance),
  auditLogsAsActor: many(auditLogs, { relationName: "actor" }),
  auditLogsAsTarget: many(auditLogs, { relationName: "target" }),
}));

export const eventsRelations = relations(events, ({ many }) => ({
  attendances: many(attendance),
  scoreHistory: many(scoreHistory),
}));

export const attendanceRelations = relations(attendance, ({ one }) => ({
  event: one(events, {
    fields: [attendance.eventId],
    references: [events.id],
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
  pointsAwarded: integer("points_awarded").default(0),
  isActive: boolean("is_active").default(true),
  isAwarded: boolean("is_awarded").default(false),
  // Optional auto open/close window. NULL on either side = unbounded that side.
  // isActive stays the manual master override on top of this window.
  opensAt: timestamp("opens_at", { withTimezone: true }),
  closesAt: timestamp("closes_at", { withTimezone: true }),
  // Who may see/fill the form (used to gate S-Skill forms). Empty = only
  // super_admin/admin. A user qualifies if their role is in assignedRoles OR
  // their id is in assignedUserIds.
  assignedRoles: jsonb("assigned_roles").$type<string[]>().notNull().default([]),
  assignedUserIds: jsonb("assigned_user_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

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
