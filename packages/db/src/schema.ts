import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

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

// Types inferred from schema — consumed across packages.
export type UserTimezoneRow = typeof userTimezones.$inferSelect;
export type PinnedSheetRow = typeof pinnedSheets.$inferSelect;
