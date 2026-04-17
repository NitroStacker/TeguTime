import type { Guild, Message, GuildTextBasedChannel } from 'discord.js';
import { getPinnedSheet, setPinnedSheet, clearPinnedSheet } from '@tegutime/domain';
import { db } from './db';
import { buildSheetData, renderSheetEmbeds } from './sheet';

/**
 * Rebuild and edit the pinned sheet message for a guild, if one is configured.
 * Silently clears state if the message or channel has been deleted.
 */
export async function refreshPinnedSheet(guild: Guild): Promise<void> {
  const record = getPinnedSheet(db, guild.id);
  if (!record) return;

  const channel = await guild.channels.fetch(record.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    clearPinnedSheet(db, guild.id);
    return;
  }

  const message = await channel.messages.fetch(record.messageId).catch(() => null);
  if (!message) {
    clearPinnedSheet(db, guild.id);
    return;
  }

  const data = await buildSheetData(guild);
  const embeds = renderSheetEmbeds(guild, data).slice(0, 10);

  try {
    await message.edit({ embeds });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[pinnedSheet] edit failed in guild ${guild.id}: ${msg}`);
  }
}

/**
 * Create or in-place update the pinned sheet message in the target channel.
 * - Same channel as existing → edit in place (preserves pin slot).
 * - Different channel → unpin+delete old, post+pin new.
 */
export async function postPinnedSheet(
  guild: Guild,
  channel: GuildTextBasedChannel,
): Promise<Message> {
  const existing = getPinnedSheet(db, guild.id);

  if (existing && existing.channelId === channel.id) {
    const oldMsg = await channel.messages.fetch(existing.messageId).catch(() => null);
    if (oldMsg) {
      const data = await buildSheetData(guild);
      const embeds = renderSheetEmbeds(guild, data).slice(0, 10);
      await oldMsg.edit({ embeds });
      if (!oldMsg.pinned) await oldMsg.pin().catch(() => {});
      setPinnedSheet(db, guild.id, channel.id, oldMsg.id);
      return oldMsg;
    }
  }

  if (existing) {
    const oldChannel = await guild.channels.fetch(existing.channelId).catch(() => null);
    if (oldChannel?.isTextBased()) {
      const oldMsg = await oldChannel.messages
        .fetch(existing.messageId)
        .catch(() => null);
      if (oldMsg) {
        if (oldMsg.pinned) await oldMsg.unpin().catch(() => {});
        await oldMsg.delete().catch(() => {});
      }
    }
  }

  const data = await buildSheetData(guild);
  const embeds = renderSheetEmbeds(guild, data).slice(0, 10);
  const message = await channel.send({ embeds });

  try {
    await message.pin();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[pinnedSheet] pin failed: ${msg}`);
  }

  setPinnedSheet(db, guild.id, channel.id, message.id);
  return message;
}
