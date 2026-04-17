import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { data as timezoneData } from './commands/timezone.js';

const commands = [timezoneData.toJSON()];
const rest = new REST({ version: '10' }).setToken(config.token);

try {
  console.log(
    `[deploy] Registering ${commands.length} slash command(s) for guild ${config.guildId}...`
  );
  const result = await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: commands }
  );
  console.log(`[deploy] ✅ Registered ${result.length} command(s).`);
} catch (err) {
  console.error('[deploy] Failed to register commands:', err);
  process.exit(1);
}
