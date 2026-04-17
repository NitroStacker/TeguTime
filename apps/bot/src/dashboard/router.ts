import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Interaction,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import {
  archiveJam,
  assignJob,
  canTransitionJobStatus,
  createJam,
  createJob,
  editJam,
  getJam,
  getJob,
  getUserTimezone,
  isJobPriority,
  listJobs,
  removeUserTimezone,
  setJobStatus,
  setUserTimezone,
  type DashboardViewId,
  type Job,
  type JobStatus,
  type JobPriority,
  unassignJob,
} from '@tegutime/domain';
import {
  discordTimestamp,
  formatLabel,
  getCurrentTime,
  isValidTimezone,
  parseDateTimeInZone,
  searchTimezones,
} from '@tegutime/tz';
import { db } from '../db';
import { isAdmin } from '../permissions';
import { COLOR, JOB_STATUS_BADGE, PRIORITY_BADGE } from '../render/theme';
import { renderJobBoardEmbed } from '../render/jobEmbed';
import { refreshPinnedSheet, postPinnedSheet } from '../pinnedSheet';
import {
  DASH_PREFIX,
  jobActionId,
  jamCreateModalId,
  jamEditModalId,
  jobsCreateModalId,
  tzSearchModalId,
  tzSetPopularSelectId,
} from './ids';
import {
  buildContext,
  persistView,
  postDashboard,
  refreshDashboardMessage,
  renderView,
} from './index';
import { getJobsFilter, setJobsFilter } from './session';
import { jamDetailEmbed } from './views/jam';

const TIME_HINT = '`YYYY-MM-DD HH:MM` (24-hour)';

// -- Entry point --

/** Returns true if the interaction was handled. */
export async function handleDashboardInteraction(
  interaction: Interaction,
): Promise<boolean> {
  if (!interaction.inCachedGuild()) return false;
  if (interaction.isModalSubmit()) {
    if (!interaction.customId.startsWith(DASH_PREFIX + ':')) return false;
    await dispatchModal(interaction);
    return true;
  }
  if (!interaction.isMessageComponent()) return false;
  if (!interaction.customId.startsWith(DASH_PREFIX + ':')) return false;

  const parts = interaction.customId.split(':');
  const section = parts[1];
  const action = parts[2];
  const args = parts.slice(3);

  try {
    switch (section) {
      case 'nav':
        return await handleNav(interaction, action as DashboardViewId);
      case 'refresh':
        return await handleRefresh(interaction);
      case 'home':
        return await handleHomeQuick(interaction, action ?? '');
      case 'jam':
        return await handleJam(interaction, action ?? '', args);
      case 'tz':
        return await handleTz(interaction, action ?? '', args);
      case 'jobs':
        return await handleJobs(interaction, action ?? '', args);
      case 'job':
        return await handleJobAction(interaction, action ?? '', args);
      case 'admin':
        return await handleAdmin(interaction, action ?? '');
      default:
        return false;
    }
  } catch (err) {
    console.error(`[dash] handler error for ${interaction.customId}:`, err);
    await replyError(
      interaction,
      '❌ Something went wrong handling that action. Please try again.',
    );
    return true;
  }
}

// -- Helpers --

function ctxFor(
  interaction: MessageComponentInteraction<'cached'> | ModalSubmitInteraction<'cached'>,
  focusedJamId: number | null = null,
) {
  return buildContext(
    interaction.guild,
    interaction.user.id,
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false,
    focusedJamId,
  );
}

async function replyError(
  interaction: MessageComponentInteraction | ModalSubmitInteraction,
  content: string,
): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

async function updateDashboardInPlace(
  interaction: MessageComponentInteraction<'cached'>,
  view: DashboardViewId,
  focusedJamId: number | null = null,
): Promise<void> {
  const ctx = ctxFor(interaction, focusedJamId);
  const rendered = renderView(ctx, view);
  await interaction.update({ embeds: rendered.embeds, components: rendered.components });
  persistView(interaction.guildId, view, focusedJamId ?? undefined);
}

// -- Nav / refresh --

async function handleNav(
  interaction: MessageComponentInteraction<'cached'>,
  view: DashboardViewId,
): Promise<boolean> {
  await updateDashboardInPlace(interaction, view);
  return true;
}

async function handleRefresh(
  interaction: MessageComponentInteraction<'cached'>,
): Promise<boolean> {
  // Re-render whatever view is currently persisted.
  const ctx = ctxFor(interaction);
  const state = (await import('@tegutime/domain')).getDashboard(db, interaction.guildId);
  const view: DashboardViewId = state?.currentView ?? 'home';
  const rendered = renderView({ ...ctx, focusedJamId: state?.focusedJamId ?? null }, view);
  await interaction.update({ embeds: rendered.embeds, components: rendered.components });
  return true;
}

// -- Home quick actions --

async function handleHomeQuick(
  interaction: MessageComponentInteraction<'cached'>,
  action: string,
): Promise<boolean> {
  switch (action) {
    case 'board':
      await updateDashboardInPlace(interaction, 'jobs');
      return true;
    case 'mine':
      return await showMyJobs(interaction);
    case 'mytz':
      return await showMyTimezone(interaction);
  }
  return false;
}

// -- Jam --

async function handleJam(
  interaction: MessageComponentInteraction<'cached'>,
  action: string,
  args: string[],
): Promise<boolean> {
  if (action === 'focus' && interaction.isStringSelectMenu()) {
    const jamId = Number(interaction.values[0]);
    await updateDashboardInPlace(interaction, 'jam', isFinite(jamId) ? jamId : null);
    return true;
  }
  if (action === 'create') {
    if (!isAdminComp(interaction)) return denyAdmin(interaction);
    await interaction.showModal(buildCreateJamModal());
    return true;
  }
  if (action === 'edit') {
    if (!isAdminComp(interaction)) return denyAdmin(interaction);
    const jamId = Number(args[0]);
    const jam = getJam(db, interaction.guildId, jamId);
    if (!jam) {
      await replyError(interaction, `❌ No jam with id \`${jamId}\`.`);
      return true;
    }
    await interaction.showModal(buildEditJamModal(jam.id, {
      title: jam.title,
      description: jam.description,
      timezone: jam.timezone,
      startsAtUtc: jam.startsAtUtc,
      endsAtUtc: jam.endsAtUtc,
    }));
    return true;
  }
  if (action === 'archive') {
    if (!isAdminComp(interaction)) return denyAdmin(interaction);
    const jamId = Number(args[0]);
    const result = archiveJam(db, interaction.guildId, jamId);
    if (!result) {
      await replyError(interaction, `❌ No jam with id \`${jamId}\`.`);
      return true;
    }
    const { cancelJam } = await import('../scheduler');
    cancelJam(result.id);
    await updateDashboardInPlace(interaction, 'jam', null);
    await interaction.followUp({
      content: `🗂 Jam **#${result.id}** archived.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  if (action === 'details') {
    const jamId = Number(args[0]);
    const jam = getJam(db, interaction.guildId, jamId);
    if (!jam) {
      await replyError(interaction, `❌ No jam with id \`${jamId}\`.`);
      return true;
    }
    await interaction.reply({
      embeds: [jamDetailEmbed(jam, Date.now())],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  return false;
}

// -- Timezones --

async function handleTz(
  interaction: MessageComponentInteraction<'cached'>,
  action: string,
  args: string[],
): Promise<boolean> {
  if (action === 'set') {
    if (args[0] === 'popular' && interaction.isStringSelectMenu()) {
      const tz = interaction.values[0];
      if (!tz || !isValidTimezone(tz)) {
        await replyError(interaction, '❌ Invalid timezone.');
        return true;
      }
      setUserTimezone(db, interaction.guildId, interaction.user.id, tz);
      await refreshPinnedSheet(interaction.guild).catch(() => {});
      await interaction.update({
        content: `✅ Timezone set to **${formatLabel(tz)}** — local time **${getCurrentTime(tz)}**.`,
        embeds: [],
        components: [],
      });
      await refreshDashboardMessage(interaction.client, interaction.guildId).catch(() => {});
      return true;
    }
    // Initial "Set Mine" click — show an ephemeral picker.
    const popular = searchTimezones('', 25);
    const select = new StringSelectMenuBuilder()
      .setCustomId(tzSetPopularSelectId())
      .setPlaceholder('Pick your timezone…')
      .addOptions(
        popular.map((p) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(p.label.slice(0, 100))
            .setValue(p.value.slice(0, 100)),
        ),
      );
    const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('dash:tz:search')
        .setLabel("Don't see it? Search by city")
        .setEmoji('🔎')
        .setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({
      content:
        '🌍 **Pick your timezone**\nChoose from the common zones below, or search by IANA name.',
      components: [row1, row2],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  if (action === 'search') {
    const modal = new ModalBuilder()
      .setCustomId(tzSearchModalId())
      .setTitle('Search timezone by IANA name');
    const input = new TextInputBuilder()
      .setCustomId('iana')
      .setLabel('IANA timezone')
      .setPlaceholder('e.g. America/New_York, Europe/Amsterdam, Asia/Tokyo')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(64);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );
    await interaction.showModal(modal);
    return true;
  }
  if (action === 'remove') {
    const removed = removeUserTimezone(db, interaction.guildId, interaction.user.id);
    if (removed) await refreshPinnedSheet(interaction.guild).catch(() => {});
    await updateDashboardInPlace(interaction, 'timezones');
    await interaction.followUp({
      content: removed
        ? '✅ Your timezone has been removed from the sheet.'
        : 'ℹ️ You did not have a timezone saved.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }
  if (action === 'sheet') {
    // Full sheet in an ephemeral reply.
    const { buildSheetData, renderSheetEmbeds } = await import('../sheet');
    const data = await buildSheetData(interaction.guild);
    const embeds = renderSheetEmbeds(interaction.guild, data).slice(0, 10);
    await interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
    return true;
  }
  return false;
}

// -- Jobs list + filters --

async function handleJobs(
  interaction: MessageComponentInteraction<'cached'>,
  action: string,
  args: string[],
): Promise<boolean> {
  if (action === 'filter' && args[0] === 'status' && interaction.isStringSelectMenu()) {
    const v = interaction.values[0];
    setJobsFilter(interaction.guildId, {
      status: v === 'all' ? 'all' : (v as JobStatus),
      page: 1,
    });
    await updateDashboardInPlace(interaction, 'jobs');
    return true;
  }
  if (action === 'filter' && args[0] === 'jam' && interaction.isStringSelectMenu()) {
    const v = interaction.values[0];
    let jamId: number | 'any' = 'any';
    if (v === 'any') jamId = 'any';
    else if (v === 'none') jamId = 'any';
    else if (v?.startsWith('j:')) jamId = Number(v.slice(2));
    setJobsFilter(interaction.guildId, { jamId, page: 1 });
    await updateDashboardInPlace(interaction, 'jobs');
    return true;
  }
  if (action === 'page') {
    const page = Math.max(1, Number(args[0]) || 1);
    setJobsFilter(interaction.guildId, { page });
    await updateDashboardInPlace(interaction, 'jobs');
    return true;
  }
  if (action === 'pick' && interaction.isStringSelectMenu()) {
    const jobId = Number(interaction.values[0]);
    const job = getJob(db, interaction.guildId, jobId);
    if (!job) {
      await replyError(interaction, '❌ Job no longer exists.');
      return true;
    }
    await showJobActionPanel(interaction, job);
    return true;
  }
  if (action === 'create') {
    await interaction.showModal(buildCreateJobModal());
    return true;
  }
  if (action === 'mine') {
    return await showMyJobs(interaction);
  }
  return false;
}

// -- Per-job actions (claim, complete, etc.) --

async function handleJobAction(
  interaction: MessageComponentInteraction<'cached'>,
  action: string,
  args: string[],
): Promise<boolean> {
  const jobId = Number(args[0]);
  const job = getJob(db, interaction.guildId, jobId);
  if (!job) {
    await replyError(interaction, '❌ Job no longer exists.');
    return true;
  }
  const admin = isAdminComp(interaction);

  const applyAndRefresh = async (label: string, updated: Job | null) => {
    if (!updated) {
      await replyError(interaction, '❌ Action failed.');
      return;
    }
    await interaction.update({
      content: `✅ **#${updated.id}** — ${label}.`,
      embeds: [],
      components: [],
    });
    await refreshDashboardMessage(interaction.client, interaction.guildId).catch(() => {});
  };

  switch (action) {
    case 'view':
      {
        const { renderJobEmbed } = await import('../render/jobEmbed');
        await interaction.reply({
          embeds: [renderJobEmbed(job)],
          flags: MessageFlags.Ephemeral,
        });
      }
      return true;
    case 'claim':
      if (job.assigneeId && job.assigneeId !== interaction.user.id && !admin) {
        await replyError(interaction, `❌ Already claimed by <@${job.assigneeId}>.`);
        return true;
      }
      await applyAndRefresh(
        `claimed by ${interaction.user.tag}`,
        assignJob(db, interaction.guildId, jobId, interaction.user.id),
      );
      return true;
    case 'unclaim':
      if (job.assigneeId !== interaction.user.id && !admin) {
        await replyError(interaction, '❌ Only the assignee or an admin can unclaim.');
        return true;
      }
      await applyAndRefresh('unclaimed', unassignJob(db, interaction.guildId, jobId));
      return true;
    case 'start':
      if (!canTransitionJobStatus(job, interaction.user.id, admin)) {
        await replyError(interaction, '❌ Only the assignee or an admin can change status.');
        return true;
      }
      await applyAndRefresh(
        'now in progress',
        setJobStatus(db, interaction.guildId, jobId, 'in_progress'),
      );
      return true;
    case 'block':
      if (!canTransitionJobStatus(job, interaction.user.id, admin)) {
        await replyError(interaction, '❌ Only the assignee or an admin can change status.');
        return true;
      }
      await applyAndRefresh('marked blocked', setJobStatus(db, interaction.guildId, jobId, 'blocked'));
      return true;
    case 'complete':
      if (!canTransitionJobStatus(job, interaction.user.id, admin)) {
        await replyError(interaction, '❌ Only the assignee or an admin can change status.');
        return true;
      }
      await applyAndRefresh(
        'marked complete',
        setJobStatus(db, interaction.guildId, jobId, 'complete'),
      );
      return true;
    case 'uncomplete':
      if (!canTransitionJobStatus(job, interaction.user.id, admin)) {
        await replyError(interaction, '❌ Only the assignee or an admin can change status.');
        return true;
      }
      {
        const next: JobStatus = job.assigneeId ? 'assigned' : 'unassigned';
        await applyAndRefresh(
          'reopened',
          setJobStatus(db, interaction.guildId, jobId, next),
        );
      }
      return true;
  }
  return false;
}

async function showJobActionPanel(
  interaction: StringSelectMenuInteraction<'cached'>,
  job: Job,
): Promise<void> {
  const isAssignee = job.assigneeId === interaction.user.id;
  const admin = isAdminComp(interaction);
  const canTransition = isAssignee || admin;
  const isComplete = job.status === 'complete';
  const isBlocked = job.status === 'blocked';

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(jobActionId('view', job.id))
      .setEmoji('🔍')
      .setLabel('View')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(jobActionId(job.assigneeId === interaction.user.id ? 'unclaim' : 'claim', job.id))
      .setEmoji(job.assigneeId === interaction.user.id ? '↩️' : '🙋')
      .setLabel(job.assigneeId === interaction.user.id ? 'Unclaim' : 'Claim')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(
        Boolean(job.assigneeId && job.assigneeId !== interaction.user.id && !admin),
      ),
    new ButtonBuilder()
      .setCustomId(jobActionId('start', job.id))
      .setEmoji('▶️')
      .setLabel('Start')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canTransition || isComplete),
    new ButtonBuilder()
      .setCustomId(jobActionId('block', job.id))
      .setEmoji('🟠')
      .setLabel('Block')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canTransition || isComplete || isBlocked),
    new ButtonBuilder()
      .setCustomId(jobActionId(isComplete ? 'uncomplete' : 'complete', job.id))
      .setEmoji(isComplete ? '↩️' : '✅')
      .setLabel(isComplete ? 'Reopen' : 'Complete')
      .setStyle(isComplete ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(!canTransition),
  );

  const embed = new EmbedBuilder()
    .setTitle(`#${job.id} · ${job.title}`)
    .setColor(COLOR.PRIMARY)
    .setDescription(
      `${JOB_STATUS_BADGE[job.status as JobStatus]} · ${PRIORITY_BADGE[job.priority as JobPriority]}${
        job.assigneeId ? ` · <@${job.assigneeId}>` : ''
      }${
        job.dueAtUtc != null
          ? ` · due ${discordTimestamp(job.dueAtUtc, 'R')}`
          : ''
      }`,
    );

  await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

// -- Admin --

async function handleAdmin(
  interaction: MessageComponentInteraction<'cached'>,
  action: string,
): Promise<boolean> {
  if (!isAdminComp(interaction)) return denyAdmin(interaction);

  if (action === 'pinsheet') {
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      await replyError(interaction, '❌ Pinned sheet needs to be created from a text channel.');
      return true;
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
      await replyError(
        interaction,
        '❌ I need **View Channel**, **Send Messages**, **Embed Links**, **Read Message History**, and **Manage Messages** in this channel to pin the sheet.',
      );
      return true;
    }
    try {
      const msg = await postPinnedSheet(interaction.guild, channel);
      await updateDashboardInPlace(interaction, 'admin');
      await interaction.followUp({
        content: `✅ Pinned sheet posted. [Jump](${msg.url})`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      console.error('[dash] pin sheet failed:', err);
      await replyError(interaction, '❌ Failed to pin the sheet.');
    }
    return true;
  }
  if (action === 'repost') {
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      await replyError(interaction, '❌ Run this from the channel you want the dashboard in.');
      return true;
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
      await interaction.editReply(`✅ Dashboard reposted. [Jump](${url})`);
    } catch (err) {
      console.error('[dash] repost failed:', err);
      await interaction.editReply('❌ Failed to repost the dashboard.');
    }
    return true;
  }
  return false;
}

// -- Modal submissions --

async function dispatchModal(interaction: ModalSubmitInteraction<'cached'>): Promise<void> {
  if (interaction.customId === jamCreateModalId()) {
    await submitCreateJam(interaction);
    return;
  }
  if (interaction.customId.startsWith(DASH_PREFIX + ':jam:edit:') && interaction.customId.endsWith(':submit')) {
    const id = Number(interaction.customId.split(':')[3]);
    await submitEditJam(interaction, id);
    return;
  }
  if (interaction.customId === tzSearchModalId()) {
    await submitTzSearch(interaction);
    return;
  }
  if (interaction.customId === jobsCreateModalId()) {
    await submitCreateJob(interaction);
    return;
  }
}

function buildCreateJamModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(jamCreateModalId()).setTitle('Create a jam');
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Title')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1800),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('start')
        .setLabel(`Start — ${TIME_HINT}`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(32),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('end')
        .setLabel(`End — ${TIME_HINT}`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(32),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('timezone')
        .setLabel('Timezone (IANA, e.g. America/New_York)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(64),
    ),
  );
  return modal;
}

function buildEditJamModal(
  id: number,
  current: { title: string; description: string | null; timezone: string; startsAtUtc: number; endsAtUtc: number },
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(jamEditModalId(id))
    .setTitle(`Edit jam #${id}`);

  const startIso = new Date(current.startsAtUtc).toISOString().slice(0, 16).replace('T', ' ');
  const endIso = new Date(current.endsAtUtc).toISOString().slice(0, 16).replace('T', ' ');

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Title')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
        .setValue(current.title),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1800)
        .setValue(current.description ?? ''),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('start')
        .setLabel(`Start UTC — ${TIME_HINT}`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(32)
        .setValue(startIso),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('end')
        .setLabel(`End UTC — ${TIME_HINT}`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(32)
        .setValue(endIso),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('timezone')
        .setLabel('Timezone (IANA)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(64)
        .setValue(current.timezone),
    ),
  );
  return modal;
}

function buildCreateJobModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(jobsCreateModalId()).setTitle('Create a job');
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Title')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1800),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('category')
        .setLabel('Category (optional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(32),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('priority')
        .setLabel('Priority — low | normal | high | urgent')
        .setPlaceholder('normal')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(10),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('due')
        .setLabel(`Due (optional) — ${TIME_HINT}`)
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(32),
    ),
  );
  return modal;
}

async function submitCreateJam(interaction: ModalSubmitInteraction<'cached'>): Promise<void> {
  if (!isAdminModal(interaction)) {
    await replyError(interaction, '❌ You need **Manage Server**.');
    return;
  }
  const title = interaction.fields.getTextInputValue('title').trim();
  const description = interaction.fields.getTextInputValue('description').trim() || null;
  const start = interaction.fields.getTextInputValue('start').trim();
  const end = interaction.fields.getTextInputValue('end').trim();
  const tz = interaction.fields.getTextInputValue('timezone').trim();

  if (!isValidTimezone(tz)) {
    await replyError(interaction, `❌ \`${tz}\` is not a valid IANA timezone.`);
    return;
  }
  const startUtc = parseDateTimeInZone(start, tz);
  const endUtc = parseDateTimeInZone(end, tz);
  if (!startUtc || !endUtc) {
    await replyError(interaction, `❌ Invalid start or end time. Use ${TIME_HINT}.`);
    return;
  }
  if (endUtc <= startUtc) {
    await replyError(interaction, '❌ End must be after start.');
    return;
  }

  const jam = createJam(db, {
    guildId: interaction.guildId,
    title,
    description,
    startsAtUtc: startUtc,
    endsAtUtc: endUtc,
    timezone: tz,
    createdBy: interaction.user.id,
  });
  const { syncJam } = await import('../scheduler');
  syncJam(jam.id);

  await interaction.reply({
    content: `✅ Jam **#${jam.id}** created. The dashboard will refresh momentarily.`,
    flags: MessageFlags.Ephemeral,
  });
  await refreshDashboardMessage(interaction.client, interaction.guildId).catch(() => {});
}

async function submitEditJam(
  interaction: ModalSubmitInteraction<'cached'>,
  jamId: number,
): Promise<void> {
  if (!isAdminModal(interaction)) {
    await replyError(interaction, '❌ You need **Manage Server**.');
    return;
  }
  const existing = getJam(db, interaction.guildId, jamId);
  if (!existing) {
    await replyError(interaction, `❌ No jam with id \`${jamId}\`.`);
    return;
  }
  const title = interaction.fields.getTextInputValue('title').trim();
  const description = interaction.fields.getTextInputValue('description').trim();
  const start = interaction.fields.getTextInputValue('start').trim();
  const end = interaction.fields.getTextInputValue('end').trim();
  const tz = interaction.fields.getTextInputValue('timezone').trim();

  if (!isValidTimezone(tz)) {
    await replyError(interaction, `❌ \`${tz}\` is not a valid IANA timezone.`);
    return;
  }
  const startUtc = parseDateTimeInZone(start, tz);
  const endUtc = parseDateTimeInZone(end, tz);
  if (!startUtc || !endUtc) {
    await replyError(interaction, `❌ Invalid start or end time. Use ${TIME_HINT}.`);
    return;
  }
  if (endUtc <= startUtc) {
    await replyError(interaction, '❌ End must be after start.');
    return;
  }

  const updated = editJam(db, interaction.guildId, jamId, {
    title,
    description: description || null,
    startsAtUtc: startUtc,
    endsAtUtc: endUtc,
    timezone: tz,
  });
  if (!updated) {
    await replyError(interaction, '❌ Update failed.');
    return;
  }
  const { syncJam } = await import('../scheduler');
  syncJam(updated.id);
  await interaction.reply({
    content: `✅ Jam **#${updated.id}** updated.`,
    flags: MessageFlags.Ephemeral,
  });
  await refreshDashboardMessage(interaction.client, interaction.guildId).catch(() => {});
}

async function submitTzSearch(interaction: ModalSubmitInteraction<'cached'>): Promise<void> {
  const iana = interaction.fields.getTextInputValue('iana').trim();
  if (!isValidTimezone(iana)) {
    await replyError(
      interaction,
      `❌ \`${iana}\` is not a valid IANA timezone. Try something like \`America/New_York\` or \`Europe/Paris\`.`,
    );
    return;
  }
  setUserTimezone(db, interaction.guildId, interaction.user.id, iana);
  await refreshPinnedSheet(interaction.guild).catch(() => {});
  await interaction.reply({
    content: `✅ Timezone set to **${formatLabel(iana)}** — local time **${getCurrentTime(iana)}**.`,
    flags: MessageFlags.Ephemeral,
  });
  await refreshDashboardMessage(interaction.client, interaction.guildId).catch(() => {});
}

async function submitCreateJob(interaction: ModalSubmitInteraction<'cached'>): Promise<void> {
  const title = interaction.fields.getTextInputValue('title').trim();
  const description = interaction.fields.getTextInputValue('description').trim() || null;
  const category = interaction.fields.getTextInputValue('category').trim() || null;
  const priorityRaw = interaction.fields.getTextInputValue('priority').trim().toLowerCase() || 'normal';
  const dueStr = interaction.fields.getTextInputValue('due').trim();
  const priority: JobPriority = isJobPriority(priorityRaw) ? priorityRaw : 'normal';

  let dueAtUtc: number | null = null;
  if (dueStr) {
    dueAtUtc = parseDateTimeInZone(dueStr, 'UTC');
    if (dueAtUtc == null) {
      await replyError(interaction, `❌ Invalid due date. Use ${TIME_HINT} (UTC).`);
      return;
    }
  }

  const job = createJob(db, {
    guildId: interaction.guildId,
    title,
    description,
    category,
    priority,
    dueAtUtc,
    createdBy: interaction.user.id,
  });
  await interaction.reply({
    content: `✅ Job **#${job.id}** created.`,
    flags: MessageFlags.Ephemeral,
  });
  await refreshDashboardMessage(interaction.client, interaction.guildId).catch(() => {});
}

// -- Personal ephemeral views --

async function showMyJobs(
  interaction: MessageComponentInteraction<'cached'>,
): Promise<boolean> {
  const jobs = listJobs(db, interaction.guildId, {
    jamId: 'any',
    assigneeId: interaction.user.id,
    includeArchived: false,
  });
  const embeds = renderJobBoardEmbed(jobs, {
    title: `📋 ${interaction.user.tag}`,
    scope: `Your jobs`,
  });
  await interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
  return true;
}

async function showMyTimezone(
  interaction: MessageComponentInteraction<'cached'>,
): Promise<boolean> {
  const tz = getUserTimezone(db, interaction.guildId, interaction.user.id);
  const content = tz
    ? `🕒 Your timezone is **${formatLabel(tz)}** — local time **${getCurrentTime(tz)}**.`
    : 'You have not set a timezone yet. Open the **Timezones** tab and click **Set Mine**.';
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  return true;
}

// -- Permission shorthands --

function isAdminComp(interaction: MessageComponentInteraction<'cached'>): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}
function isAdminModal(interaction: ModalSubmitInteraction<'cached'>): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}
function denyAdmin(interaction: MessageComponentInteraction): Promise<boolean> {
  return interaction
    .reply({
      content: '❌ That action requires the **Manage Server** permission.',
      flags: MessageFlags.Ephemeral,
    })
    .then(() => true);
}
