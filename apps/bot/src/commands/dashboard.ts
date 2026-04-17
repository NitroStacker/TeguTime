import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { postDashboard } from '../dashboard';
import { isAdmin } from '../permissions';

export const data = new SlashCommandBuilder()
  .setName('dashboard')
  .setDescription('Post or move the TeguTime control panel (Manage Server)')
  .setDMPermission(false)
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Where to post (defaults to the current channel)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) return;
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ You need **Manage Server** to post the dashboard.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  if (!channel || !('send' in channel)) {
    await interaction.reply({
      content: '❌ Choose a text channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const me = await interaction.guild.members.fetchMe();
  const perms = channel.permissionsFor(me);
  const needed = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ReadMessageHistory,
  ];
  if (needed.some((p) => !perms?.has(p))) {
    await interaction.reply({
      content:
        `❌ I am missing permissions in ${channel}. I need **View Channel**, **Send Messages**, **Embed Links**, and **Read Message History**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const url = await postDashboard(
      interaction.client,
      interaction.guild,
      channel,
      interaction.user.id,
      true,
    );
    await interaction.editReply(`✅ Dashboard posted in ${channel}. [Jump](${url})`);
  } catch (err) {
    console.error('[dashboard] post failed:', err);
    await interaction.editReply('❌ Failed to post the dashboard.');
  }
}
