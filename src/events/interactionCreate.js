import { Events, MessageFlags } from 'discord.js';
import * as timezoneCmd from '../commands/timezone.js';

const commands = new Map([['timezone', timezoneCmd]]);

export const name = Events.InteractionCreate;

export async function execute(interaction) {
  const cmd = commands.get(interaction.commandName);
  if (!cmd) return;

  try {
    if (interaction.isAutocomplete()) {
      if (cmd.autocomplete) await cmd.autocomplete(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) {
      await cmd.execute(interaction);
    }
  } catch (err) {
    console.error(`[interaction] error in /${interaction.commandName}:`, err);
    if (!interaction.isChatInputCommand()) return;

    const payload = {
      content: '❌ Something went wrong while handling that command. Please try again.',
      flags: MessageFlags.Ephemeral
    };
    if (interaction.deferred || interaction.replied) {
      interaction.followUp(payload).catch(() => {});
    } else {
      interaction.reply(payload).catch(() => {});
    }
  }
}
