import { Events, ActivityType } from 'discord.js';
import { refreshPinnedSheet } from '../pinnedSheet.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client) {
  console.log(`[ready] Logged in as ${client.user.tag}`);
  client.user.setActivity('timezones', { type: ActivityType.Watching });

  // Refresh each guild's pinned sheet so changes that happened while
  // the bot was offline (role moves, nickname edits, members leaving)
  // are reconciled on startup.
  for (const [, guild] of client.guilds.cache) {
    try {
      await refreshPinnedSheet(guild);
    } catch (err) {
      console.error(`[ready] pinned refresh failed for ${guild.id}:`, err);
    }
  }
}
