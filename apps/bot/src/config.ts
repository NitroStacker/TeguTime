import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

// Repo root lives three levels up from apps/bot/src.
export const repoRoot = path.resolve(here, '../../..');

dotenv.config({ path: path.join(repoRoot, '.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[config] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  guildId: required('DISCORD_GUILD_ID'),
  pinnedChannelId: process.env.PINNED_CHANNEL_ID?.trim() || null,
  databasePath: process.env.DATABASE_PATH
    ? path.resolve(repoRoot, process.env.DATABASE_PATH)
    : path.join(repoRoot, 'data', 'timezones.db'),
} as const;
