import { getPinnedSheet, setPinnedSheet, clearPinnedSheet } from './db.js';
import { buildSheetData, renderSheetEmbeds } from './sheet.js';

/**
 * Rebuild and edit the pinned sheet message for a guild, if one is configured.
 * Silently clears state if the message or channel has been deleted.
 */
export async function refreshPinnedSheet(guild) {
  const record = getPinnedSheet(guild.id);
  if (!record) return;

  const channel = await guild.channels.fetch(record.channel_id).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    clearPinnedSheet(guild.id);
    return;
  }

  const message = await channel.messages.fetch(record.message_id).catch(() => null);
  if (!message) {
    clearPinnedSheet(guild.id);
    return;
  }

  const data = await buildSheetData(guild);
  const embeds = renderSheetEmbeds(guild, data).slice(0, 10);

  try {
    await message.edit({ embeds });
  } catch (err) {
    console.error(
      `[pinnedSheet] failed to edit message in guild ${guild.id}: ${err.message}`
    );
  }
}

/**
 * Create (or update in-place) the pinned sheet message in the target channel.
 * - If a pinned sheet already exists in the same channel, it is edited in place
 *   so the pin keeps its slot in the channel's pinned list.
 * - If it exists in a different channel, the old message is unpinned/deleted
 *   and a new one is posted.
 */
export async function postPinnedSheet(guild, channel) {
  const existing = getPinnedSheet(guild.id);

  if (existing && existing.channel_id === channel.id) {
    const oldMsg = await channel.messages
      .fetch(existing.message_id)
      .catch(() => null);
    if (oldMsg) {
      const data = await buildSheetData(guild);
      const embeds = renderSheetEmbeds(guild, data).slice(0, 10);
      await oldMsg.edit({ embeds });
      if (!oldMsg.pinned) await oldMsg.pin().catch(() => {});
      setPinnedSheet(guild.id, channel.id, oldMsg.id);
      return oldMsg;
    }
  }

  if (existing) {
    const oldChannel = await guild.channels
      .fetch(existing.channel_id)
      .catch(() => null);
    if (oldChannel?.isTextBased()) {
      const oldMsg = await oldChannel.messages
        .fetch(existing.message_id)
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
    console.warn(
      `[pinnedSheet] could not pin message in #${channel.name}: ${err.message}`
    );
  }

  setPinnedSheet(guild.id, channel.id, message.id);
  return message;
}
