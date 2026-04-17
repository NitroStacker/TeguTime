import 'dotenv/config';

export const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  pinnedChannelId: process.env.PINNED_CHANNEL_ID || null,
  databasePath: process.env.DATABASE_PATH || './data/timezones.db'
};

function requireVar(name, value) {
  if (!value) {
    console.error(`[config] Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

requireVar('DISCORD_TOKEN', config.token);
requireVar('DISCORD_CLIENT_ID', config.clientId);
requireVar('DISCORD_GUILD_ID', config.guildId);
