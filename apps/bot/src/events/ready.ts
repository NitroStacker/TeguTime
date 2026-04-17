import { Events, ActivityType, type Client } from 'discord.js';
import { refreshPinnedSheet } from '../pinnedSheet';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client: Client<true>): Promise<void> {
  console.log(`[ready] Logged in as ${client.user.tag}`);
  client.user.setActivity('timezones', { type: ActivityType.Watching });

  // Reconcile pinned sheets on startup to catch changes that happened offline.
  for (const [, guild] of client.guilds.cache) {
    try {
      await refreshPinnedSheet(guild);
    } catch (err) {
      console.error(`[ready] pinned refresh failed for ${guild.id}:`, err);
    }
  }
}
