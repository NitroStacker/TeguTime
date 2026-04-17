import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import {
  setUserTimezone,
  getUserTimezone,
  removeUserTimezone,
} from '@tegutime/domain';
import {
  isValidTimezone,
  searchTimezones,
  formatLabel,
  getCurrentTime,
} from '@tegutime/tz';
import { db } from '../db';
import { buildSheetData, renderSheetEmbeds } from '../sheet';
import { refreshPinnedSheet, postPinnedSheet } from '../pinnedSheet';
import { config } from '../config';

export const data = new SlashCommandBuilder()
  .setName('timezone')
  .setDescription('Manage your timezone and view the server timezone sheet')
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('set')
      .setDescription('Set your timezone (autocomplete by city, region, or UTC offset)')
      .addStringOption((opt) =>
        opt
          .setName('timezone')
          .setDescription('Start typing a city, region, or UTC offset')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('set-for')
      .setDescription("Set another member's timezone (Manage Server required)")
      .addUserOption((opt) =>
        opt.setName('user').setDescription('The member whose timezone to set').setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName('timezone')
          .setDescription('Start typing a city, region, or UTC offset')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('remove').setDescription('Remove your timezone from the sheet'),
  )
  .addSubcommand((sub) =>
    sub.setName('me').setDescription('Show your currently saved timezone'),
  )
  .addSubcommand((sub) =>
    sub.setName('sheet').setDescription('Display the full server timezone sheet'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('post-sheet')
      .setDescription('Post or refresh the pinned timezone sheet in a channel')
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Channel to post the pinned sheet (defaults to PINNED_CHANNEL_ID)')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('help').setDescription('Learn how to use the timezone bot'),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused();
  const results = searchTimezones(focused, 25);
  await interaction.respond(
    results.map((r) => ({
      name: r.label.slice(0, 100),
      value: r.value.slice(0, 100),
    })),
  );
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) return;
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'set':
      return handleSet(interaction);
    case 'set-for':
      return handleSetFor(interaction);
    case 'remove':
      return handleRemove(interaction);
    case 'me':
      return handleMe(interaction);
    case 'sheet':
      return handleSheet(interaction);
    case 'post-sheet':
      return handlePostSheet(interaction);
    case 'help':
      return handleHelp(interaction);
  }
}

async function handleSet(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const tz = interaction.options.getString('timezone', true);

  if (!isValidTimezone(tz)) {
    await interaction.reply({
      content: `❌ \`${tz}\` is not a valid IANA timezone. Please pick a suggestion from the autocomplete list.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  setUserTimezone(db, interaction.guildId, interaction.user.id, tz);

  await interaction.reply({
    content: `✅ Timezone set to **${formatLabel(tz)}**. Your current local time is **${getCurrentTime(tz)}**.`,
    flags: MessageFlags.Ephemeral,
  });

  refreshPinnedSheet(interaction.guild).catch((err) =>
    console.error('[set] pinned refresh failed:', err),
  );
}

async function handleSetFor(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "❌ You need the **Manage Server** permission to set another member's timezone.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const target = interaction.options.getUser('user', true);
  const tz = interaction.options.getString('timezone', true);

  if (target.bot) {
    await interaction.reply({
      content: '❌ Bots cannot have a timezone.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!isValidTimezone(tz)) {
    await interaction.reply({
      content: `❌ \`${tz}\` is not a valid IANA timezone. Please pick a suggestion from the autocomplete list.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (!member) {
    await interaction.reply({
      content: `❌ ${target} is not a member of this server.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  setUserTimezone(db, interaction.guildId, target.id, tz);

  await interaction.reply({
    content: `✅ Set ${target}'s timezone to **${formatLabel(tz)}** — local time **${getCurrentTime(tz)}**.`,
    flags: MessageFlags.Ephemeral,
  });

  refreshPinnedSheet(interaction.guild).catch((err) =>
    console.error('[set-for] pinned refresh failed:', err),
  );
}

async function handleRemove(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const removed = removeUserTimezone(db, interaction.guildId, interaction.user.id);

  await interaction.reply({
    content: removed
      ? '✅ Your timezone has been removed from the sheet.'
      : 'ℹ️ You did not have a timezone saved.',
    flags: MessageFlags.Ephemeral,
  });

  if (removed) {
    refreshPinnedSheet(interaction.guild).catch((err) =>
      console.error('[remove] pinned refresh failed:', err),
    );
  }
}

async function handleMe(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const tz = getUserTimezone(db, interaction.guildId, interaction.user.id);
  if (!tz) {
    await interaction.reply({
      content: 'You have not set a timezone yet. Use `/timezone set` to add one.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `🕒 Your timezone is **${formatLabel(tz)}** — local time is **${getCurrentTime(tz)}**.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSheet(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  await interaction.deferReply();
  const data = await buildSheetData(interaction.guild);
  const embeds = renderSheetEmbeds(interaction.guild, data).slice(0, 10);
  await interaction.editReply({ embeds });
}

async function handlePostSheet(
  interaction: ChatInputCommandInteraction<'cached'>,
): Promise<void> {
  let channel = interaction.options.getChannel('channel');
  if (!channel && config.pinnedChannelId) {
    channel = await interaction.guild.channels
      .fetch(config.pinnedChannelId)
      .catch(() => null);
  }
  if (!channel) {
    await interaction.reply({
      content:
        '❌ No channel was specified and `PINNED_CHANNEL_ID` is not configured. Pass the `channel` option.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!channel.isTextBased()) {
    await interaction.reply({
      content: '❌ The chosen channel is not a text channel.',
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
    PermissionFlagsBits.ManageMessages,
  ];
  if (needed.some((p) => !perms?.has(p))) {
    await interaction.reply({
      content:
        `❌ I am missing permissions in ${channel}. I need: **View Channel**, **Send Messages**, ` +
        '**Embed Links**, **Read Message History**, and **Manage Messages** (to pin).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const msg = await postPinnedSheet(interaction.guild, channel);
    await interaction.editReply(
      `✅ Pinned sheet is live in ${channel}. [Jump to message](${msg.url})`,
    );
  } catch (err) {
    console.error('[post-sheet] failed:', err);
    await interaction.editReply(
      '❌ Failed to post the pinned sheet. Check my permissions and try again.',
    );
  }
}

async function handleHelp(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('🕒 Timezone Bot — Help')
    .setColor(0x5865f2)
    .setDescription(
      "Track your server's members across timezones. Internally the bot stores IANA zones, so daylight-savings is always handled correctly — the UTC offset labels you see are generated on the fly.",
    )
    .addFields(
      {
        name: '/timezone set `<timezone>`',
        value:
          'Set your timezone. Start typing a city (`Tokyo`), a region (`Europe`), or an offset (`UTC-5`) and pick from the autocomplete suggestions.',
      },
      {
        name: '/timezone set-for `<user> <timezone>`',
        value:
          "Set another member's timezone on their behalf. Requires **Manage Server**.",
      },
      {
        name: '/timezone remove',
        value: 'Remove yourself from the sheet.',
      },
      {
        name: '/timezone me',
        value: 'Show the timezone you currently have saved, plus your current local time.',
      },
      {
        name: '/timezone sheet',
        value: 'Display the full timezone sheet in this channel.',
      },
      {
        name: '/timezone post-sheet `[channel]`',
        value:
          'Post or refresh the **pinned** timezone sheet. Re-running in the same channel updates the existing pin; pointing to a new channel moves it.',
      },
      {
        name: '/timezone help',
        value: 'Show this message.',
      },
    )
    .setFooter({
      text: 'The pinned sheet updates automatically when members join, leave, change roles, or change timezones.',
    });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
