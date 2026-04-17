import { Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import { getUserTimezone, removeUserTimezone } from '@tegutime/domain';
import { db } from '../db';
import { refreshPinnedSheet } from '../pinnedSheet';

export const name = Events.GuildMemberRemove;

export async function execute(member: GuildMember | PartialGuildMember): Promise<void> {
  const had = getUserTimezone(db, member.guild.id, member.id);
  if (!had) return;

  removeUserTimezone(db, member.guild.id, member.id);
  refreshPinnedSheet(member.guild).catch((err) =>
    console.error('[guildMemberRemove] refresh failed:', err),
  );
}
