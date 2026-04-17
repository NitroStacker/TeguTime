import {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import {
  createJam,
  editJam,
  deleteJam,
  archiveJam,
  getJam,
  listJams,
  getJamStatus,
  type JamRow,
} from '@tegutime/domain';
import { isValidTimezone, parseDateTimeInZone, searchTimezones } from '@tegutime/tz';
import { db } from '../db';
import { isAdmin } from '../permissions';
import { renderJamEmbed, renderJamList } from '../render/jamEmbed';
import { syncJam as schedulerSyncJam, cancelJam as schedulerCancelJam } from '../scheduler';

const TIME_FORMAT_HINT = '`YYYY-MM-DD HH:MM` (24-hour), e.g. `2026-04-20 14:00`';

function primaryJam(guildId: string, now: number = Date.now()): JamRow | null {
  const list = listJams(db, guildId);
  if (list.length === 0) return null;
  const live = list.find((j) => getJamStatus(j, now) === 'live');
  if (live) return live;
  const upcoming = [...list]
    .sort((a, b) => a.startsAtUtc - b.startsAtUtc)
    .find((j) => getJamStatus(j, now) === 'upcoming');
  if (upcoming) return upcoming;
  const ended = list.find((j) => getJamStatus(j, now) === 'ended');
  if (ended) return ended;
  return list[0] ?? null;
}

export const data = new SlashCommandBuilder()
  .setName('jam')
  .setDescription('Game jam scheduling and status')
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Create a new jam (Manage Server)')
      .addStringOption((o) => o.setName('title').setDescription('Jam title').setRequired(true))
      .addStringOption((o) =>
        o.setName('start').setDescription('Start time — ' + TIME_FORMAT_HINT).setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('end').setDescription('End time — ' + TIME_FORMAT_HINT).setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('timezone')
          .setDescription('Timezone for start/end (autocomplete)')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((o) =>
        o.setName('description').setDescription('Longer description').setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName('submission_deadline')
          .setDescription('Optional submission deadline — same format')
          .setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName('voting_deadline')
          .setDescription('Optional voting deadline — same format')
          .setRequired(false),
      )
      .addChannelOption((o) =>
        o
          .setName('announcement_channel')
          .setDescription('Channel for automated jam reminders')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false),
      )
      .addRoleOption((o) =>
        o
          .setName('participant_role')
          .setDescription('Role pinged in reminders and listed as participants')
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('edit')
      .setDescription('Edit an existing jam (Manage Server)')
      .addIntegerOption((o) =>
        o
          .setName('id')
          .setDescription('Jam ID')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((o) => o.setName('title').setDescription('New title').setRequired(false))
      .addStringOption((o) =>
        o.setName('description').setDescription('New description').setRequired(false),
      )
      .addStringOption((o) =>
        o.setName('start').setDescription('New start — ' + TIME_FORMAT_HINT).setRequired(false),
      )
      .addStringOption((o) =>
        o.setName('end').setDescription('New end — ' + TIME_FORMAT_HINT).setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName('timezone')
          .setDescription('New timezone (used to parse start/end here and in future edits)')
          .setRequired(false)
          .setAutocomplete(true),
      )
      .addStringOption((o) =>
        o
          .setName('submission_deadline')
          .setDescription('New submission deadline (empty string clears)')
          .setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName('voting_deadline')
          .setDescription('New voting deadline (empty string clears)')
          .setRequired(false),
      )
      .addChannelOption((o) =>
        o
          .setName('announcement_channel')
          .setDescription('New announcement channel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(false),
      )
      .addRoleOption((o) =>
        o.setName('participant_role').setDescription('New participant role').setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('delete')
      .setDescription('Delete a jam permanently (Manage Server)')
      .addIntegerOption((o) =>
        o
          .setName('id')
          .setDescription('Jam ID')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('archive')
      .setDescription('Archive a jam (Manage Server)')
      .addIntegerOption((o) =>
        o
          .setName('id')
          .setDescription('Jam ID')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('status')
      .setDescription('Show the current jam status (defaults to the active one)')
      .addIntegerOption((o) =>
        o
          .setName('id')
          .setDescription('Jam ID')
          .setRequired(false)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('List all jams in this server'),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'timezone') {
    const results = searchTimezones(focused.value, 25);
    await interaction.respond(
      results.map((r) => ({
        name: r.label.slice(0, 100),
        value: r.value.slice(0, 100),
      })),
    );
    return;
  }
  if (focused.name === 'id' && interaction.inCachedGuild()) {
    const q = String(focused.value).trim().toLowerCase();
    const jams = listJams(db, interaction.guildId, { includeArchived: true });
    const matches = jams
      .filter((j) => {
        if (!q) return true;
        if (String(j.id) === q) return true;
        return j.title.toLowerCase().includes(q);
      })
      .slice(0, 25)
      .map((j) => ({
        name: `#${j.id} · ${j.title}`.slice(0, 100),
        value: j.id,
      }));
    await interaction.respond(matches);
    return;
  }
  await interaction.respond([]);
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) return;
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'create':
      return handleCreate(interaction);
    case 'edit':
      return handleEdit(interaction);
    case 'delete':
      return handleDelete(interaction);
    case 'archive':
      return handleArchive(interaction);
    case 'status':
      return handleStatus(interaction);
    case 'list':
      return handleList(interaction);
  }
}

async function handleCreate(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ You need **Manage Server** to create a jam.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const title = interaction.options.getString('title', true).trim();
  const startStr = interaction.options.getString('start', true).trim();
  const endStr = interaction.options.getString('end', true).trim();
  const tz = interaction.options.getString('timezone', true);
  const description = interaction.options.getString('description')?.trim() || null;
  const submissionStr = interaction.options.getString('submission_deadline')?.trim() || null;
  const votingStr = interaction.options.getString('voting_deadline')?.trim() || null;
  const announcementChannel = interaction.options.getChannel('announcement_channel');
  const participantRole = interaction.options.getRole('participant_role');

  if (!isValidTimezone(tz)) {
    await interaction.reply({
      content: `❌ \`${tz}\` is not a valid IANA timezone. Pick from the autocomplete list.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const startsAtUtc = parseDateTimeInZone(startStr, tz);
  const endsAtUtc = parseDateTimeInZone(endStr, tz);
  if (startsAtUtc == null || endsAtUtc == null) {
    await interaction.reply({
      content: `❌ Invalid date/time. Use ${TIME_FORMAT_HINT}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (endsAtUtc <= startsAtUtc) {
    await interaction.reply({
      content: '❌ End time must be after start time.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const submissionDeadlineUtc = submissionStr ? parseDateTimeInZone(submissionStr, tz) : null;
  const votingDeadlineUtc = votingStr ? parseDateTimeInZone(votingStr, tz) : null;
  if (submissionStr && submissionDeadlineUtc == null) {
    await interaction.reply({
      content: `❌ Invalid submission deadline. Use ${TIME_FORMAT_HINT}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (votingStr && votingDeadlineUtc == null) {
    await interaction.reply({
      content: `❌ Invalid voting deadline. Use ${TIME_FORMAT_HINT}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const jam = createJam(db, {
    guildId: interaction.guildId,
    title,
    description,
    startsAtUtc,
    endsAtUtc,
    timezone: tz,
    submissionDeadlineUtc,
    votingDeadlineUtc,
    announcementChannelId: announcementChannel?.id ?? null,
    participantRoleId: participantRole?.id ?? null,
    createdBy: interaction.user.id,
  });

  schedulerSyncJam(jam.id);

  await interaction.reply({
    embeds: [renderJamEmbed(jam)],
    content: `✅ Jam **#${jam.id}** created. Reminders scheduled: start, halfway, 24h, 1h, end.`,
  });
}

async function handleEdit(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ You need **Manage Server** to edit a jam.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const jamId = interaction.options.getInteger('id', true);
  const existing = getJam(db, interaction.guildId, jamId);
  if (!existing) {
    await interaction.reply({
      content: `❌ No jam with id \`${jamId}\` in this server.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const tzOpt = interaction.options.getString('timezone');
  const tz = tzOpt ?? existing.timezone;
  if (tzOpt && !isValidTimezone(tzOpt)) {
    await interaction.reply({
      content: `❌ \`${tzOpt}\` is not a valid IANA timezone.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const startStr = interaction.options.getString('start');
  const endStr = interaction.options.getString('end');
  const subStr = interaction.options.getString('submission_deadline');
  const voteStr = interaction.options.getString('voting_deadline');

  const startsAtUtc =
    startStr != null ? parseDateTimeInZone(startStr, tz) : undefined;
  const endsAtUtc = endStr != null ? parseDateTimeInZone(endStr, tz) : undefined;
  if (startStr != null && startsAtUtc == null) {
    await interaction.reply({
      content: `❌ Invalid start — ${TIME_FORMAT_HINT}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (endStr != null && endsAtUtc == null) {
    await interaction.reply({
      content: `❌ Invalid end — ${TIME_FORMAT_HINT}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const finalStart = startsAtUtc ?? existing.startsAtUtc;
  const finalEnd = endsAtUtc ?? existing.endsAtUtc;
  if (finalEnd <= finalStart) {
    await interaction.reply({
      content: '❌ End time must be after start time.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let submissionDeadlineUtc: number | null | undefined;
  if (subStr != null) {
    submissionDeadlineUtc = subStr === '' ? null : parseDateTimeInZone(subStr, tz);
    if (subStr !== '' && submissionDeadlineUtc == null) {
      await interaction.reply({
        content: `❌ Invalid submission_deadline — ${TIME_FORMAT_HINT}, or empty string to clear.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }
  let votingDeadlineUtc: number | null | undefined;
  if (voteStr != null) {
    votingDeadlineUtc = voteStr === '' ? null : parseDateTimeInZone(voteStr, tz);
    if (voteStr !== '' && votingDeadlineUtc == null) {
      await interaction.reply({
        content: `❌ Invalid voting_deadline — ${TIME_FORMAT_HINT}, or empty string to clear.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  const announcementChannel = interaction.options.getChannel('announcement_channel');
  const participantRole = interaction.options.getRole('participant_role');

  const updated = editJam(db, interaction.guildId, jamId, {
    title: interaction.options.getString('title') ?? undefined,
    description: interaction.options.getString('description') ?? undefined,
    startsAtUtc: startsAtUtc ?? undefined,
    endsAtUtc: endsAtUtc ?? undefined,
    timezone: tzOpt ?? undefined,
    submissionDeadlineUtc,
    votingDeadlineUtc,
    announcementChannelId: announcementChannel?.id ?? undefined,
    participantRoleId: participantRole?.id ?? undefined,
  });
  if (!updated) {
    await interaction.reply({
      content: '❌ Failed to update jam.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  schedulerSyncJam(updated.id);

  await interaction.reply({
    content: `✅ Jam **#${updated.id}** updated.`,
    embeds: [renderJamEmbed(updated)],
  });
}

async function handleDelete(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ You need **Manage Server** to delete a jam.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const jamId = interaction.options.getInteger('id', true);
  schedulerCancelJam(jamId);
  const removed = deleteJam(db, interaction.guildId, jamId);
  await interaction.reply({
    content: removed
      ? `🗑 Jam **#${jamId}** deleted.`
      : `❌ No jam with id \`${jamId}\`.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleArchive(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ You need **Manage Server** to archive a jam.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const jamId = interaction.options.getInteger('id', true);
  const archived = archiveJam(db, interaction.guildId, jamId);
  if (!archived) {
    await interaction.reply({
      content: `❌ No jam with id \`${jamId}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  schedulerCancelJam(archived.id);
  await interaction.reply({
    content: `🗂 Jam **#${archived.id}** archived. Future reminders cancelled.`,
  });
}

async function handleStatus(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const jamId = interaction.options.getInteger('id');
  const jam = jamId != null ? getJam(db, interaction.guildId, jamId) : primaryJam(interaction.guildId);
  if (!jam) {
    await interaction.reply({
      content: jamId != null
        ? `❌ No jam with id \`${jamId}\`.`
        : '_No jams yet. Create one with `/jam create`._',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.reply({ embeds: [renderJamEmbed(jam)] });
}

async function handleList(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const jams = listJams(db, interaction.guildId, { includeArchived: true });
  await interaction.reply({ embeds: [renderJamList(jams)] });
}

// Helper for other commands (e.g. /job) to resolve a friendly jam reference.
export function resolveGuildJam(guildId: string, id: number | null): JamRow | null {
  if (id == null) return null;
  return getJam(db, guildId, id);
}

export { TIME_FORMAT_HINT };
