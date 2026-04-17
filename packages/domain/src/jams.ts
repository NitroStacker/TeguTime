import { and, asc, desc, eq, isNull, lte } from 'drizzle-orm';
import {
  type Db,
  jams,
  jamReminders,
  type JamRow,
  type JamReminderRow,
} from '@tegutime/db';

// ---- Types ----

export type JamStatus = 'upcoming' | 'live' | 'ended' | 'archived';

export const REMINDER_KINDS = [
  'start',
  'halfway',
  '24h_before_end',
  '1h_before_end',
  'end',
] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export interface CreateJamInput {
  guildId: string;
  title: string;
  description?: string | null;
  startsAtUtc: number;
  endsAtUtc: number;
  timezone: string;
  submissionDeadlineUtc?: number | null;
  votingDeadlineUtc?: number | null;
  announcementChannelId?: string | null;
  participantRoleId?: string | null;
  createdBy: string;
}

export interface EditJamInput {
  title?: string;
  description?: string | null;
  startsAtUtc?: number;
  endsAtUtc?: number;
  timezone?: string;
  submissionDeadlineUtc?: number | null;
  votingDeadlineUtc?: number | null;
  announcementChannelId?: string | null;
  participantRoleId?: string | null;
}

// ---- Status ----

export function getJamStatus(jam: JamRow, now: number = Date.now()): JamStatus {
  if (jam.archivedAt != null) return 'archived';
  if (now < jam.startsAtUtc) return 'upcoming';
  if (now < jam.endsAtUtc) return 'live';
  return 'ended';
}

// ---- Reminder scheduling ----

/**
 * Compute the UTC timestamp at which a reminder of the given kind should fire
 * for a jam. Returns null if the reminder would fire before the jam is created
 * (e.g. a 24h-before-end reminder on a jam shorter than 24 hours).
 */
export function computeReminderFireAt(
  kind: ReminderKind,
  startsAtUtc: number,
  endsAtUtc: number,
): number | null {
  switch (kind) {
    case 'start':
      return startsAtUtc;
    case 'halfway':
      return Math.floor((startsAtUtc + endsAtUtc) / 2);
    case '24h_before_end': {
      const at = endsAtUtc - 24 * 60 * 60 * 1000;
      return at > startsAtUtc ? at : null;
    }
    case '1h_before_end': {
      const at = endsAtUtc - 60 * 60 * 1000;
      return at > startsAtUtc ? at : null;
    }
    case 'end':
      return endsAtUtc;
  }
}

// ---- CRUD ----

export function createJam(db: Db, input: CreateJamInput): JamRow {
  const now = Date.now();
  return db.transaction((tx) => {
    const jam = tx
      .insert(jams)
      .values({
        guildId: input.guildId,
        title: input.title,
        description: input.description ?? null,
        startsAtUtc: input.startsAtUtc,
        endsAtUtc: input.endsAtUtc,
        timezone: input.timezone,
        submissionDeadlineUtc: input.submissionDeadlineUtc ?? null,
        votingDeadlineUtc: input.votingDeadlineUtc ?? null,
        announcementChannelId: input.announcementChannelId ?? null,
        participantRoleId: input.participantRoleId ?? null,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      })
      .returning()
      .get();

    for (const kind of REMINDER_KINDS) {
      const fireAt = computeReminderFireAt(kind, jam.startsAtUtc, jam.endsAtUtc);
      if (fireAt == null) continue;
      tx.insert(jamReminders)
        .values({ jamId: jam.id, kind, fireAtUtc: fireAt, enabled: true, firedAt: null })
        .run();
    }

    return jam;
  });
}

export function getJam(db: Db, guildId: string, jamId: number): JamRow | null {
  const row = db
    .select()
    .from(jams)
    .where(and(eq(jams.id, jamId), eq(jams.guildId, guildId)))
    .get();
  return row ?? null;
}

export function listJams(
  db: Db,
  guildId: string,
  opts: { includeArchived?: boolean } = {},
): JamRow[] {
  const rows = db
    .select()
    .from(jams)
    .where(eq(jams.guildId, guildId))
    .orderBy(desc(jams.startsAtUtc))
    .all();
  return opts.includeArchived ? rows : rows.filter((j) => j.archivedAt == null);
}

export function editJam(
  db: Db,
  guildId: string,
  jamId: number,
  patch: EditJamInput,
): JamRow | null {
  const existing = getJam(db, guildId, jamId);
  if (!existing) return null;

  const hasScheduleChange =
    patch.startsAtUtc !== undefined || patch.endsAtUtc !== undefined;

  return db.transaction((tx) => {
    const updated = tx
      .update(jams)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.startsAtUtc !== undefined ? { startsAtUtc: patch.startsAtUtc } : {}),
        ...(patch.endsAtUtc !== undefined ? { endsAtUtc: patch.endsAtUtc } : {}),
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        ...(patch.submissionDeadlineUtc !== undefined
          ? { submissionDeadlineUtc: patch.submissionDeadlineUtc }
          : {}),
        ...(patch.votingDeadlineUtc !== undefined
          ? { votingDeadlineUtc: patch.votingDeadlineUtc }
          : {}),
        ...(patch.announcementChannelId !== undefined
          ? { announcementChannelId: patch.announcementChannelId }
          : {}),
        ...(patch.participantRoleId !== undefined
          ? { participantRoleId: patch.participantRoleId }
          : {}),
        updatedAt: Date.now(),
      })
      .where(and(eq(jams.id, jamId), eq(jams.guildId, guildId)))
      .returning()
      .get();

    if (hasScheduleChange && updated) {
      // Clear future reminders and recreate from the new schedule.
      // Already-fired reminders are preserved for audit.
      tx.delete(jamReminders)
        .where(and(eq(jamReminders.jamId, jamId), isNull(jamReminders.firedAt)))
        .run();

      for (const kind of REMINDER_KINDS) {
        const fireAt = computeReminderFireAt(kind, updated.startsAtUtc, updated.endsAtUtc);
        if (fireAt == null) continue;
        tx.insert(jamReminders)
          .values({ jamId: updated.id, kind, fireAtUtc: fireAt, enabled: true, firedAt: null })
          .onConflictDoUpdate({
            target: [jamReminders.jamId, jamReminders.kind],
            set: { fireAtUtc: fireAt, enabled: true, firedAt: null },
          })
          .run();
      }
    }

    return updated ?? null;
  });
}

export function deleteJam(db: Db, guildId: string, jamId: number): boolean {
  const result = db
    .delete(jams)
    .where(and(eq(jams.id, jamId), eq(jams.guildId, guildId)))
    .run();
  return result.changes > 0;
}

export function archiveJam(db: Db, guildId: string, jamId: number): JamRow | null {
  const now = Date.now();
  const updated = db
    .update(jams)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(jams.id, jamId), eq(jams.guildId, guildId)))
    .returning()
    .get();
  return updated ?? null;
}

// ---- Reminders ----

export function listPendingReminders(db: Db): JamReminderRow[] {
  return db
    .select()
    .from(jamReminders)
    .where(and(isNull(jamReminders.firedAt), eq(jamReminders.enabled, true)))
    .all();
}

export function listDueReminders(db: Db, now: number = Date.now()): JamReminderRow[] {
  return db
    .select()
    .from(jamReminders)
    .where(
      and(
        isNull(jamReminders.firedAt),
        eq(jamReminders.enabled, true),
        lte(jamReminders.fireAtUtc, now),
      ),
    )
    .orderBy(asc(jamReminders.fireAtUtc))
    .all();
}

export function listRemindersForJam(db: Db, jamId: number): JamReminderRow[] {
  return db
    .select()
    .from(jamReminders)
    .where(eq(jamReminders.jamId, jamId))
    .orderBy(asc(jamReminders.fireAtUtc))
    .all();
}

export function getReminder(db: Db, reminderId: number): JamReminderRow | null {
  const row = db.select().from(jamReminders).where(eq(jamReminders.id, reminderId)).get();
  return row ?? null;
}

export function markReminderFired(db: Db, reminderId: number, firedAt: number = Date.now()): void {
  db.update(jamReminders)
    .set({ firedAt })
    .where(eq(jamReminders.id, reminderId))
    .run();
}

export function setReminderEnabled(db: Db, reminderId: number, enabled: boolean): void {
  db.update(jamReminders).set({ enabled }).where(eq(jamReminders.id, reminderId)).run();
}
