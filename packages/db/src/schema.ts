import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core';

// ---- Timezones (Phase 1a) ----

export const userTimezones = sqliteTable(
  'user_timezones',
  {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    timezone: text('timezone').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.guildId, t.userId] }),
  }),
);

export const pinnedSheets = sqliteTable('pinned_sheets', {
  guildId: text('guild_id').primaryKey(),
  channelId: text('channel_id').notNull(),
  messageId: text('message_id').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ---- Jams (Phase 1b) ----

export const jams = sqliteTable(
  'jams',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    startsAtUtc: integer('starts_at_utc').notNull(),
    endsAtUtc: integer('ends_at_utc').notNull(),
    timezone: text('timezone').notNull(),
    submissionDeadlineUtc: integer('submission_deadline_utc'),
    votingDeadlineUtc: integer('voting_deadline_utc'),
    announcementChannelId: text('announcement_channel_id'),
    participantRoleId: text('participant_role_id'),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    archivedAt: integer('archived_at'),
  },
  (t) => ({
    guildIdx: index('jams_guild_idx').on(t.guildId),
  }),
);

/**
 * Scheduled reminders for a jam. Idempotency is enforced at the DB level by
 * a unique (jam_id, kind) constraint so we never double-send on replays.
 */
export const jamReminders = sqliteTable(
  'jam_reminders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jamId: integer('jam_id')
      .notNull()
      .references(() => jams.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'start' | 'halfway' | '24h_before_end' | '1h_before_end' | 'end'
    fireAtUtc: integer('fire_at_utc').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    firedAt: integer('fired_at'),
  },
  (t) => ({
    kindUniq: uniqueIndex('jam_reminders_kind_unique').on(t.jamId, t.kind),
    fireIdx: index('jam_reminders_fire_idx').on(t.fireAtUtc, t.firedAt),
  }),
);

// ---- Jobs (Phase 1c) ----

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    jamId: integer('jam_id').references(() => jams.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    category: text('category'),
    priority: text('priority').notNull().default('normal'), // 'low' | 'normal' | 'high' | 'urgent'
    status: text('status').notNull().default('unassigned'),
    // 'unassigned' | 'assigned' | 'in_progress' | 'blocked' | 'complete' | 'cancelled'
    assigneeId: text('assignee_id'),
    dueAtUtc: integer('due_at_utc'),
    tags: text('tags').notNull().default('[]'), // JSON array (parsed by domain layer)
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    archivedAt: integer('archived_at'),
  },
  (t) => ({
    guildIdx: index('jobs_guild_idx').on(t.guildId),
    jamIdx: index('jobs_jam_idx').on(t.jamId),
    assigneeIdx: index('jobs_assignee_idx').on(t.assigneeId),
    statusIdx: index('jobs_status_idx').on(t.status),
  }),
);

export const jobComments = sqliteTable(
  'job_comments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    jobIdx: index('job_comments_job_idx').on(t.jobId),
  }),
);

// ---- Inferred row types ----

export type UserTimezoneRow = typeof userTimezones.$inferSelect;
export type PinnedSheetRow = typeof pinnedSheets.$inferSelect;
export type JamRow = typeof jams.$inferSelect;
export type JamReminderRow = typeof jamReminders.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type JobCommentRow = typeof jobComments.$inferSelect;
