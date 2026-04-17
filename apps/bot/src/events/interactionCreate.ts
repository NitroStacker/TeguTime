import {
  Events,
  MessageFlags,
  type Interaction,
  type InteractionReplyOptions,
} from 'discord.js';
import * as timezoneCmd from '../commands/timezone';
import * as jamCmd from '../commands/jam';
import * as jobCmd from '../commands/job';
import * as dashboardCmd from '../commands/dashboard';
import * as artCmd from '../commands/art';
import { handleDashboardInteraction } from '../dashboard/router';

type CommandModule = {
  data: { name: string };
  execute: (interaction: Interaction) => Promise<unknown>;
  autocomplete?: (interaction: Interaction) => Promise<unknown>;
};

const commands = new Map<string, CommandModule>([
  ['timezone', timezoneCmd as CommandModule],
  ['jam', jamCmd as CommandModule],
  ['job', jobCmd as CommandModule],
  ['dashboard', dashboardCmd as CommandModule],
  ['art', artCmd as CommandModule],
]);

export const name = Events.InteractionCreate;

export async function execute(interaction: Interaction): Promise<void> {
  try {
    // Dashboard interactions (buttons / selects / modals with "dash:" prefix)
    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      const handled = await handleDashboardInteraction(interaction);
      if (handled) return;
    }

    const commandName =
      interaction.isChatInputCommand() || interaction.isAutocomplete()
        ? interaction.commandName
        : null;
    if (!commandName) return;

    const cmd = commands.get(commandName);
    if (!cmd) return;

    if (interaction.isAutocomplete()) {
      if (cmd.autocomplete) await cmd.autocomplete(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) {
      await cmd.execute(interaction);
    }
  } catch (err) {
    console.error(`[interaction] error:`, err);
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
