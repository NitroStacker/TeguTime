import { Events } from 'discord.js';
import { getUserTimezone } from '../db.js';
import { refreshPinnedSheet } from '../pinnedSheet.js';

export const name = Events.GuildMemberUpdate;

export async function execute(oldMember, newMember) {
  // Only bother refreshing if this user actually appears on the sheet.
  if (!getUserTimezone(newMember.guild.id, newMember.id)) return;

  // If old state is partial, we can't diff — refresh to be safe.
  if (oldMember.partial) {
    refreshPinnedSheet(newMember.guild).catch((err) =>
      console.error('[guildMemberUpdate] refresh failed:', err)
    );
    return;
  }

  const nicknameChanged = oldMember.displayName !== newMember.displayName;
  const roleIdsOld = [...oldMember.roles.cache.keys()].sort().join(',');
  const roleIdsNew = [...newMember.roles.cache.keys()].sort().join(',');
  const rolesChanged = roleIdsOld !== roleIdsNew;

  if (!nicknameChanged && !rolesChanged) return;

  refreshPinnedSheet(newMember.guild).catch((err) =>
    console.error('[guildMemberUpdate] refresh failed:', err)
  );
}
