import type { Client } from 'discord.js';
import { eq } from 'drizzle-orm';
import { jams, type JamReminderRow } from '@tegutime/db';
import {
  getReminder,
  listPendingReminders,
  listRemindersForJam,
  markReminderFired,
} from '@tegutime/domain';
import { db } from './db';
import { renderReminderContent } from './render/jamEmbed';

/**
 * In-process reminder scheduler.
 *
 * Design notes:
 * - State of truth = DB. Timers are a cache.
 * - On boot we load every pending reminder and schedule it.
 * - On any jam create/edit we call `syncJam(jamId)` to reconcile — the domain
 *   layer already upserted rows; we just pull them and (re)schedule timers.
 * - `setTimeout` has a signed-32-bit ms ceiling (~24.8 days). For longer waits
 *   we multi-hop: schedule a short timer, then re-evaluate when it fires.
 * - Catch-up: at boot, anything already past its fire time fires immediately
 *   (serially) so downtime never loses a reminder.
 */
const MAX_TIMEOUT_MS = 2_147_000_000; // ~24.8 days, safely under Node's ~2^31-1 ceiling.

// reminderId → active Timeout
const timers = new Map<number, NodeJS.Timeout>();
let botClient: Client | null = null;

export function initScheduler(client: Client): void {
  botClient = client;
  const pending = listPendingReminders(db);
  for (const r of pending) scheduleOne(r);
  console.log(`[scheduler] booted with ${pending.length} pending reminder(s)`);
}

export function syncJam(jamId: number): void {
  for (const r of listRemindersForJam(db, jamId)) {
    const t = timers.get(r.id);
    if (t) {
      clearTimeout(t);
      timers.delete(r.id);
    }
    if (r.firedAt == null && r.enabled) scheduleOne(r);
  }
}

export function cancelJam(jamId: number): void {
  for (const r of listRemindersForJam(db, jamId)) {
    const t = timers.get(r.id);
    if (t) {
      clearTimeout(t);
      timers.delete(r.id);
    }
  }
}

function scheduleOne(reminder: JamReminderRow): void {
  const delay = reminder.fireAtUtc - Date.now();

  if (delay <= 0) {
    // Past-due — fire on the next event loop tick to let caller finish.
    setImmediate(() => {
      void fireReminder(reminder.id);
    });
    return;
  }

  const hop = Math.min(delay, MAX_TIMEOUT_MS);
  const timeout = setTimeout(() => {
    timers.delete(reminder.id);
    if (delay > MAX_TIMEOUT_MS) {
      // Re-fetch in case enabled/firedAt/fireAt changed during the hop.
      const fresh = getReminder(db, reminder.id);
      if (fresh && fresh.firedAt == null && fresh.enabled) scheduleOne(fresh);
    } else {
      void fireReminder(reminder.id);
    }
  }, hop);
  timers.set(reminder.id, timeout);
}

async function fireReminder(reminderId: number): Promise<void> {
  if (!botClient) return;

  const reminder = getReminder(db, reminderId);
  if (!reminder || reminder.firedAt != null) return; // already fired or gone

  const jam = db.select().from(jams).where(eq(jams.id, reminder.jamId)).get();

  if (!jam || jam.archivedAt != null) {
    markReminderFired(db, reminder.id);
    return;
  }

  if (!jam.announcementChannelId) {
    // No channel to post to — mark fired so we don't keep retrying.
    markReminderFired(db, reminder.id);
    return;
  }

  try {
    const channel = await botClient.channels.fetch(jam.announcementChannelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      markReminderFired(db, reminder.id);
      return;
    }
    const { content, embeds } = renderReminderContent(jam, reminder);
    await channel.send({ content: content || undefined, embeds });
    markReminderFired(db, reminder.id);
    console.log(`[scheduler] fired ${reminder.kind} for jam #${jam.id}`);
  } catch (err) {
    console.error(`[scheduler] failed to fire reminder ${reminder.id}:`, err);
    // Intentionally not marking fired so we retry on next boot.
  }
}

/**
 * For tests / debugging. Not exported from the barrel.
 */
export function _timerCountForTesting(): number {
  return timers.size;
}
