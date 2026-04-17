import {
  Events,
  MessageFlags,
  type Interaction,
  type InteractionReplyOptions,
} from 'discord.js';
import * as timezoneCmd from '../commands/timezone';
import * as jamCmd from '../commands/jam';
import * as jobCmd from '../commands/job';

type CommandModule = {
  data: { name: string };
  execute: (interaction: Interaction) => Promise<unknown>;
  autocomplete?: (interaction: Interaction) => Promise<unknown>;
};

const commands = new Map<string, CommandModule>([
  ['timezone', timezoneCmd as CommandModule],
  ['jam', jamCmd as CommandModule],
  ['job', jobCmd as CommandModule],
]);

export const name = Events.InteractionCreate;

export async function execute(interaction: Interaction): Promise<void> {
  const commandName =
    interaction.isChatInputCommand() || interaction.isAutocomplete()
      ? interaction.commandName
      : null;
  if (!commandName) return;

  const cmd = commands.get(commandName);
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
    console.error(`[interaction] error in /${commandName}:`, err);
    if (!interaction.isChatInputCommand()) return;

    const payload: InteractionReplyOptions = {
      content: '❌ Something went wrong while handling that command. Please try again.',
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.deferred || interaction.replied) {
      interaction.followUp(payload).catch(() => {});
    } else {
      interaction.reply(payload).catch(() => {});
    }
  }
}
