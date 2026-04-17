import { and, eq } from 'drizzle-orm';
import { type Db, userTimezones, pinnedSheets } from '@tegutime/db';

export interface UserTimezoneEntry {
  userId: string;
  timezone: string;
}

export interface PinnedSheetRecord {
  channelId: string;
  messageId: string;
}

export function setUserTimezone(
  db: Db,
  guildId: string,
  userId: string,
  timezone: string,
): void {
  db.insert(userTimezones)
    .values({ guildId, userId, timezone, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: [userTimezones.guildId, userTimezones.userId],
      set: { timezone, updatedAt: Date.now() },
    })
    .run();
}

export function getUserTimezone(db: Db, guildId: string, userId: string): string | null {
  const row = db
    .select({ timezone: userTimezones.timezone })
    .from(userTimezones)
    .where(and(eq(userTimezones.guildId, guildId), eq(userTimezones.userId, userId)))
    .get();
  return row?.timezone ?? null;
}

/**
 * Delete a user's saved timezone. Returns true if a row was actually removed.
 */
export function removeUserTimezone(db: Db, guildId: string, userId: string): boolean {
  const result = db
    .delete(userTimezones)
    .where(and(eq(userTimezones.guildId, guildId), eq(userTimezones.userId, userId)))
    .run();
  return result.changes > 0;
}

export function listGuildTimezones(db: Db, guildId: string): UserTimezoneEntry[] {
  return db
    .select({ userId: userTimezones.userId, timezone: userTimezones.timezone })
    .from(userTimezones)
    .where(eq(userTimezones.guildId, guildId))
    .all();
}

export function setPinnedSheet(
  db: Db,
  guildId: string,
  channelId: string,
  messageId: string,
): void {
  db.insert(pinnedSheets)
    .values({ guildId, channelId, messageId, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: pinnedSheets.guildId,
      set: { channelId, messageId, updatedAt: Date.now() },
    })
    .run();
}

export function getPinnedSheet(db: Db, guildId: string): PinnedSheetRecord | null {
  const row = db
    .select({ channelId: pinnedSheets.channelId, messageId: pinnedSheets.messageId })
    .from(pinnedSheets)
    .where(eq(pinnedSheets.guildId, guildId))
    .get();
  return row ?? null;
}

export function clearPinnedSheet(db: Db, guildId: string): void {
  db.delete(pinnedSheets).where(eq(pinnedSheets.guildId, guildId)).run();
}
