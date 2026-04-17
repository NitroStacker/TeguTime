import { Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import { getUserTimezone } from '@tegutime/domain';
import { db } from '../db';
import { refreshPinnedSheet } from '../pinnedSheet';

export const name = Events.GuildMemberUpdate;

export async function execute(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): Promise<void> {
  if (!getUserTimezone(db, newMember.guild.id, newMember.id)) return;

  if (oldMember.partial) {
    refreshPinnedSheet(newMember.guild).catch((err) =>
      console.error('[guildMemberUpdate] refresh failed:', err),
    );
    return;
  }

  const nicknameChanged = oldMember.displayName !== newMember.displayName;
  const roleIdsOld = [...oldMember.roles.cache.keys()].sort().join(',');
  const roleIdsNew = [...newMember.roles.cache.keys()].sort().join(',');
  const rolesChanged = roleIdsOld !== roleIdsNew;

  if (!nicknameChanged && !rolesChanged) return;

  refreshPinnedSheet(newMember.guild).catch((err) =>
    console.error('[guildMemberUpdate] refresh failed:', err),
  );
}
