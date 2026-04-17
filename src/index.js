import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.js';
import './db.js'; // side-effect import: run migrations before anything else

import * as readyEvent from './events/ready.js';
import * as interactionEvent from './events/interactionCreate.js';
import * as memberUpdateEvent from './events/guildMemberUpdate.js';
import * as memberRemoveEvent from './events/guildMemberRemove.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember, Partials.User]
});

for (const mod of [
  readyEvent,
  interactionEvent,
  memberUpdateEvent,
  memberRemoveEvent
]) {
  if (mod.once) client.once(mod.name, mod.execute);
  else client.on(mod.name, mod.execute);
}

process.on('unhandledRejection', (err) =>
  console.error('[unhandledRejection]', err)
);
process.on('uncaughtException', (err) =>
  console.error('[uncaughtException]', err)
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[shutdown] received ${signal}, closing...`);
    client.destroy();
    process.exit(0);
  });
}

client.login(config.token);
