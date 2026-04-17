import type { Guild } from 'discord.js';

/**
 * Resolve a user ID to the best display name we have for them:
 * server nickname → global display name → username → "Unknown user".
 *
 * Uses the cache first, falls back to a single fetch. Returns "Unknown user"
 * if the member has left the guild (and thus has no cached identity).
 */
export async function resolveDisplayName(guild: Guild, userId: string): Promise<string> {
  let member = guild.members.cache.get(userId);
  if (!member) {
    member = (await guild.members.fetch(userId).catch(() => undefined)) ?? undefined;
  }
  return member?.displayName ?? 'Unknown user';
}

/**
 * Bulk variant — warms the cache in one fetch for all unresolved IDs so
 * gallery directory lists don't fire N HTTP requests.
 */
export async function resolveDisplayNames(
  guild: Guild,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  const uncached = unique.filter((id) => !guild.members.cache.has(id));
  if (uncached.length > 0) {
    await guild.members.fetch({ user: uncached }).catch(() => null);
  }
  const out = new Map<string, string>();
  for (const id of unique) {
    const member = guild.members.cache.get(id);
    out.set(id, member?.displayName ?? 'Unknown user');
  }
  return out;
}
