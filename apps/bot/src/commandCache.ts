import type { Client } from 'discord.js';
import { config } from './config';

/**
 * Discord lets us embed a "command mention" (`</name sub:commandId>`) in a
 * message so users can click it to open the slash-command picker pre-filled
 * with that command. We need the live command IDs to build those mentions, so
 * the bot caches them at `ready`.
 *
 * Cache is re-hydrated on every restart. If we ever need this cache to work
 * across bot deploys, persist it — but that's unnecessary for now because the
 * ready handler runs before any dashboard render.
 */
const idsByName = new Map<string, string>();

export async function hydrateCommandCache(client: Client): Promise<void> {
  const guild =
    client.guilds.cache.get(config.guildId) ??
    (await client.guilds.fetch(config.guildId).catch(() => null));
  if (!guild) return;
  const commands = await guild.commands.fetch().catch(() => null);
  if (!commands) return;
  idsByName.clear();
  for (const cmd of commands.values()) {
    idsByName.set(cmd.name, cmd.id);
  }
  console.log(`[commands] cached ${idsByName.size} command id(s).`);
}

/**
 * Build a clickable command mention, e.g. `</art upload:12345>`. Returns a
 * sensible plain-text fallback if the cache isn't hydrated yet.
 */
export function commandMention(commandName: string, subcommand?: string): string {
  const id = idsByName.get(commandName);
  const display = subcommand ? `${commandName} ${subcommand}` : commandName;
  if (!id) return `\`/${display}\``;
  return `</${display}:${id}>`;
}
