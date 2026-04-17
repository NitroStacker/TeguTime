import { Events } from 'discord.js';
import { getUserTimezone, removeUserTimezone } from '../db.js';
import { refreshPinnedSheet } from '../pinnedSheet.js';

export const name = Events.GuildMemberRemove;

export async function execute(member) {
  const had = getUserTimezone(member.guild.id, member.id);
  if (!had) return;

  removeUserTimezone(member.guild.id, member.id);
  refreshPinnedSheet(member.guild).catch((err) =>
    console.error('[guildMemberRemove] refresh failed:', err)
  );
}
