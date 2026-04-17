import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config';
import './db'; // side-effect import: open DB + bootstrap schema before anything else

import * as readyEvent from './events/ready';
import * as interactionEvent from './events/interactionCreate';
import * as memberUpdateEvent from './events/guildMemberUpdate';
import * as memberRemoveEvent from './events/guildMemberRemove';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember, Partials.User],
});

const modules = [readyEvent, interactionEvent, memberUpdateEvent, memberRemoveEvent];
for (const mod of modules) {
  const handler = mod.execute as (...args: unknown[]) => unknown;
  if ('once' in mod && mod.once) {
    client.once(mod.name, handler);
  } else {
    client.on(mod.name, handler);
  }
}

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[shutdown] received ${signal}, closing...`);
    client.destroy();
    process.exit(0);
  });
}

void client.login(config.token);
