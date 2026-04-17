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
  getArtItem,
  getArtboard,
  getJam,
  getJob,
  getUserTimezone,
  isArtCategory,
  isJobPriority,
  listArtItems,
  listBoardOwners,
  listJams,
  listJobs,
  recordModAction,
  removeUserTimezone,
  setArtboardBio,
  setArtboardFeatured,
  setJobStatus,
  setUserTimezone,
  softDeleteArtItem,
  summarizeJamGallery,
  updateArtItem,
  type ArtCategory,
  type ArtItem,
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
  artBioBtnId,
  artBioModalId,
  artBoardPickSelectId,
  artBoardViewId,
  artBrowseBtnId,
  artEditModalId,
  artItemActionId,
  artItemPickSelectId,
  artJamBtnId,
  artJamGalleryId,
  artJamPickSelectId,
  artMyBoardBtnId,
  artUploadBtnId,
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
      case 'art':
        return await handleArt(interaction, action ?? '', args);
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
    case 'admin':
      if (!isAdminComp(interaction)) return denyAdmin(interaction);
      await updateDashboardInPlace(interaction, 'admin');
      return true;
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
  if (
    interaction.customId.startsWith(DASH_PREFIX + ':art:item:edit:') &&
    interaction.customId.endsWith(':submit')
  ) {
    const id = Number(interaction.customId.split(':')[4]);
    await submitEditArt(interaction, id);
    return;
  }
  if (interaction.customId === artBioModalId()) {
    await submitBio(interaction);
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

// -- Art (Artboard) --

import type { StringSelectMenuInteraction as SSMI } from 'discord.js';
import {
  CATEGORY_LABEL,
  renderArtItemEmbed,
  renderBoardLandingEmbed,
  renderBrowseDirectoryEmbed,
  renderJamGalleryEmbed,
} from '../render/artEmbed';
import { freshUrlFor } from '../artStorage';
import type { DashboardRow } from './types';
import { resolveDisplayName, resolveDisplayNames } from '../userNames';

const ART_PAGE_SIZE = 1; // one item at a time — gallery feel

async function handleArt(
  interaction: MessageComponentInteraction<'cached'>,
  action: string,
  args: string[],
): Promise<boolean> {
  switch (action) {
    case 'myboard':
      return await showBoardView(interaction, interaction.user.id, 0, 'reply');
    case 'browse':
      return await showBoardDirectory(interaction, 'reply');
    case 'boardpick':
      if (!interaction.isStringSelectMenu()) return false;
      return await showBoardView(interaction, interaction.values[0] ?? '', 0, 'update');
    case 'board': {
      const ownerId = args[0] ?? '';
      const page = Math.max(0, Number(args[1]) || 0);
      return await showBoardView(interaction, ownerId, page, 'update');
    }
    case 'jam':
      return await showJamSelector(interaction, 'reply');
    case 'jampick':
      if (!interaction.isStringSelectMenu()) return false;
      return await showJamGalleryView(
        interaction,
        Number(interaction.values[0]),
        0,
        'update',
      );
    case 'jamview': {
      const jamId = Number(args[0]);
      const page = Math.max(0, Number(args[1]) || 0);
      return await showJamGalleryView(interaction, jamId, page, 'update');
    }
    case 'pick':
      if (!interaction.isStringSelectMenu()) return false;
      return await handleItemPick(interaction, args, interaction.values[0] ?? '');
    case 'upload':
      return await showUploadGuide(interaction);
    case 'bio':
      return await openBioModal(interaction);
    case 'item': {
      const itemAction = args[0] ?? '';
      const itemId = Number(args[1]);
      return await handleItemAction(interaction, itemAction, itemId);
    }
  }
  return false;
}

function responseMode(mode: 'reply' | 'update') {
  return mode;
}

async function showBoardDirectory(
  interaction: MessageComponentInteraction<'cached'>,
  mode: 'reply' | 'update',
): Promise<boolean> {
  const boards = listBoardOwners(db, interaction.guildId);
  const embed = renderBrowseDirectoryEmbed(boards);

  const rows: DashboardRow[] = [];
  if (boards.length > 0) {
    const names = await resolveDisplayNames(
      interaction.guild,
      boards.map((b) => b.userId),
    );
    const select = new StringSelectMenuBuilder()
      .setCustomId(artBoardPickSelectId())
      .setPlaceholder('Pick a creator…')
      .addOptions(
        boards.slice(0, 25).map((b) =>
          new StringSelectMenuOptionBuilder()
            .setLabel((names.get(b.userId) ?? 'Unknown user').slice(0, 100))
            .setDescription(
              `${b.itemCount} item${b.itemCount === 1 ? '' : 's'}`.slice(0, 100),
            )
            .setValue(b.userId),
        ),
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(artMyBoardBtnId())
        .setEmoji('🖼')
        .setLabel('My Board')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(artJamBtnId())
        .setEmoji('🎮')
        .setLabel('Jam Gallery')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(artUploadBtnId())
        .setEmoji('⬆️')
        .setLabel('Upload Art')
        .setStyle(ButtonStyle.Success),
    ),
  );

  const payload = { embeds: [embed], components: rows };
  if (mode === 'reply') {
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.update(payload);
  }
  return true;
}

async function showBoardView(
  interaction: MessageComponentInteraction<'cached'>,
  ownerId: string,
  page: number,
  mode: 'reply' | 'update',
): Promise<boolean> {
  const board = getArtboard(db, interaction.guildId, ownerId);
  const items = listArtItems(db, interaction.guildId, { ownerId, sort: 'new' });

  if (items.length === 0) {
    const featuredUrl = null;
    const ownerName = await resolveDisplayName(interaction.guild, ownerId);
    const embed = renderBoardLandingEmbed(ownerId, ownerName, board, items, featuredUrl);
    const rows: DashboardRow[] = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(artBrowseBtnId())
          .setEmoji('🏠')
          .setLabel('Back to Browse')
          .setStyle(ButtonStyle.Secondary),
        ownerIsMe(interaction, ownerId)
          ? new ButtonBuilder()
              .setCustomId(artUploadBtnId())
              .setEmoji('⬆️')
              .setLabel('Upload Art')
              .setStyle(ButtonStyle.Success)
          : new ButtonBuilder()
              .setCustomId(artMyBoardBtnId())
              .setEmoji('🖼')
              .setLabel('Go to My Board')
              .setStyle(ButtonStyle.Primary),
      ),
    ];
    const payload = { embeds: [embed], components: rows };
    if (mode === 'reply') {
      await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.update(payload);
    }
    return true;
  }

  const bounded = Math.max(0, Math.min(page, items.length - 1));
  const item = items[bounded]!;
  const freshUrl = await freshUrlFor(interaction.client, item);
  const embed = renderArtItemEmbed(item, freshUrl, {
    position: { index: bounded, total: items.length },
  });

  const rows = buildItemViewerRows({
    interaction,
    item,
    items,
    page: bounded,
    scope: { kind: 'board', ownerId },
  });

  const payload = { embeds: [embed], components: rows };
  if (mode === 'reply') {
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.update(payload);
  }
  return true;
}

async function showJamSelector(
  interaction: MessageComponentInteraction<'cached'>,
  mode: 'reply' | 'update',
): Promise<boolean> {
  const jams = listJams(db, interaction.guildId, { includeArchived: true });
  if (jams.length === 0) {
    const payload = {
      content: '_No jams exist yet. Ask an admin to create one, then come back._',
      embeds: [],
      components: [],
    };
    if (mode === 'reply') {
      await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.update(payload);
    }
    return true;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(artJamPickSelectId())
    .setPlaceholder('Pick a jam…')
    .addOptions(
      jams.slice(0, 25).map((j) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`#${j.id} · ${j.title}`.slice(0, 100))
          .setValue(String(j.id)),
      ),
    );
  const rows: DashboardRow[] = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(artBrowseBtnId())
        .setEmoji('🏠')
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
  const embed = new EmbedBuilder()
    .setTitle('🎮 Jam Gallery')
    .setColor(COLOR.PRIMARY)
    .setDescription('Pick a jam to see its gallery of contributions.');
  const payload = { embeds: [embed], components: rows };
  if (mode === 'reply') {
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.update(payload);
  }
  return true;
}

async function showJamGalleryView(
  interaction: MessageComponentInteraction<'cached'>,
  jamId: number,
  page: number,
  mode: 'reply' | 'update',
): Promise<boolean> {
  const jam = getJam(db, interaction.guildId, jamId);
  if (!jam) {
    await replyError(interaction, `❌ No jam with id \`${jamId}\`.`);
    return true;
  }
  const items = listArtItems(db, interaction.guildId, { jamId, sort: 'new' });

  if (items.length === 0) {
    const summary = summarizeJamGallery(db, interaction.guildId, jamId);
    const embed = renderJamGalleryEmbed(jam.title, summary);
    const rows: DashboardRow[] = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(artJamBtnId())
          .setEmoji('🎮')
          .setLabel('Pick another jam')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(artBrowseBtnId())
          .setEmoji('🏠')
          .setLabel('Back')
          .setStyle(ButtonStyle.Secondary),
      ),
    ];
    const payload = { embeds: [embed], components: rows };
    if (mode === 'reply') {
      await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.update(payload);
    }
    return true;
  }

  const bounded = Math.max(0, Math.min(page, items.length - 1));
  const item = items[bounded]!;
  const freshUrl = await freshUrlFor(interaction.client, item);
  const embed = renderArtItemEmbed(item, freshUrl, {
    position: { index: bounded, total: items.length },
    jamTitle: jam.title,
  });

  const rows = buildItemViewerRows({
    interaction,
    item,
    items,
    page: bounded,
    scope: { kind: 'jam', jamId },
  });

  const payload = { embeds: [embed], components: rows };
  if (mode === 'reply') {
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.update(payload);
  }
  return true;
}

function ownerIsMe(interaction: MessageComponentInteraction<'cached'>, ownerId: string): boolean {
  return interaction.user.id === ownerId;
}

interface ItemViewerScope {
  kind: 'board' | 'jam';
  ownerId?: string;
  jamId?: number;
}

function buildItemViewerRows({
  interaction,
  item,
  items,
  page,
  scope,
}: {
  interaction: MessageComponentInteraction<'cached'>;
  item: ArtItem;
  items: ArtItem[];
  page: number;
  scope: { kind: 'board'; ownerId: string } | { kind: 'jam'; jamId: number };
}): DashboardRow[] {
  const admin = isAdminComp(interaction);
  const isOwner = interaction.user.id === item.ownerId;
  const canEdit = isOwner || admin;

  const prevId =
    scope.kind === 'board'
      ? artBoardViewId(scope.ownerId, Math.max(0, page - 1))
      : artJamGalleryId(scope.jamId, Math.max(0, page - 1));
  const nextId =
    scope.kind === 'board'
      ? artBoardViewId(scope.ownerId, page + 1)
      : artJamGalleryId(scope.jamId, page + 1);

  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(prevId)
      .setEmoji('◀')
      .setLabel('Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(nextId)
      .setEmoji('▶')
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= items.length - 1),
    new ButtonBuilder()
      .setCustomId(artItemActionId('edit', item.id))
      .setEmoji('✏')
      .setLabel('Edit')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!canEdit),
    new ButtonBuilder()
      .setCustomId(artItemActionId(item.featured ? 'unfeature' : 'feature', item.id))
      .setEmoji('⭐')
      .setLabel(item.featured ? 'Unfeature' : 'Feature')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isOwner),
    new ButtonBuilder()
      .setCustomId(artItemActionId('delete', item.id))
      .setEmoji('🗑')
      .setLabel('Delete')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!canEdit),
  );

  const pickScope = scope.kind === 'board' ? `b-${scope.ownerId}` : `j-${scope.jamId}`;
  const pickSelect = new StringSelectMenuBuilder()
    .setCustomId(artItemPickSelectId(pickScope))
    .setPlaceholder('Jump to item…')
    .addOptions(
      items.slice(0, 25).map((i, idx) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${i.featured ? '⭐ ' : ''}${`#${i.id} · ${i.title}`.slice(0, 90)}`.slice(0, 100))
          .setDescription(
            `${i.mediaType}${i.category ? ' · ' + (CATEGORY_LABEL[i.category as ArtCategory] ?? i.category) : ''}`.slice(
              0,
              100,
            ),
          )
          .setValue(String(i.id))
          .setDefault(idx === page),
      ),
    );
  const pickRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(pickSelect);

  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(scope.kind === 'board' ? artBrowseBtnId() : artJamBtnId())
      .setEmoji('🏠')
      .setLabel(scope.kind === 'board' ? 'Back to Browse' : 'Pick another jam')
      .setStyle(ButtonStyle.Secondary),
  );
  if (admin && !isOwner) {
    backRow.addComponents(
      new ButtonBuilder()
        .setCustomId(artItemActionId('modremove', item.id))
        .setEmoji('🛡')
        .setLabel('Mod Remove')
        .setStyle(ButtonStyle.Danger),
    );
  }
  if (isOwner && scope.kind === 'board') {
    backRow.addComponents(
      new ButtonBuilder()
        .setCustomId(artBioBtnId())
        .setEmoji('📝')
        .setLabel('Edit Bio')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  return [nav, pickRow, backRow];
}

async function handleItemPick(
  interaction: SSMI<'cached'>,
  args: string[],
  chosenItemId: string,
): Promise<boolean> {
  const scopeKey = args[0] ?? '';
  const itemId = Number(chosenItemId);
  if (scopeKey.startsWith('b-')) {
    const ownerId = scopeKey.slice(2);
    const items = listArtItems(db, interaction.guildId, { ownerId, sort: 'new' });
    const page = items.findIndex((i) => i.id === itemId);
    return await showBoardView(interaction, ownerId, Math.max(0, page), 'update');
  }
  if (scopeKey.startsWith('j-')) {
    const jamId = Number(scopeKey.slice(2));
    const items = listArtItems(db, interaction.guildId, { jamId, sort: 'new' });
    const page = items.findIndex((i) => i.id === itemId);
    return await showJamGalleryView(interaction, jamId, Math.max(0, page), 'update');
  }
  return false;
}

async function handleItemAction(
  interaction: MessageComponentInteraction<'cached'>,
  action: string,
  itemId: number,
): Promise<boolean> {
  const item = getArtItem(db, interaction.guildId, itemId);
  if (!item || item.deletedAt) {
    await replyError(interaction, '❌ That item no longer exists.');
    return true;
  }
  const admin = isAdminComp(interaction);
  const isOwner = interaction.user.id === item.ownerId;

  if (action === 'edit') {
    if (!(isOwner || admin)) {
      await replyError(interaction, '❌ Only the owner or an admin can edit this item.');
      return true;
    }
    await interaction.showModal(buildEditArtModal(item));
    return true;
  }
  if (action === 'delete') {
    if (!(isOwner || admin)) {
      await replyError(interaction, '❌ Only the owner or an admin can delete this item.');
      return true;
    }
    softDeleteArtItem(db, interaction.guildId, item.id);
    if (!isOwner && admin) {
      recordModAction(db, interaction.guildId, item.id, interaction.user.id, 'remove');
    }
    await interaction.update({
      content: `🗑 **#${item.id}** deleted.`,
      embeds: [],
      components: [backToBrowseRow()],
    });
    await refreshDashboardMessage(interaction.client, interaction.guildId).catch(() => {});
    return true;
  }
  if (action === 'feature') {
    if (!isOwner) {
      await replyError(interaction, '❌ Only the owner can feature their own art.');
      return true;
    }
    setArtboardFeatured(db, interaction.guildId, item.ownerId, item.id);
    updateArtItem(db, interaction.guildId, item.id, { featured: true });
    await refreshFromItem(interaction, item.id);
    return true;
  }
  if (action === 'unfeature') {
    if (!isOwner && !admin) {
      await replyError(interaction, '❌ Only the owner or an admin can unfeature.');
      return true;
    }
    updateArtItem(db, interaction.guildId, item.id, { featured: false });
    const board = getArtboard(db, interaction.guildId, item.ownerId);
    if (board?.featuredItemId === item.id) {
      setArtboardFeatured(db, interaction.guildId, item.ownerId, null);
    }
    if (!isOwner && admin) {
      recordModAction(db, interaction.guildId, item.id, interaction.user.id, 'unfeature');
    }
    await refreshFromItem(interaction, item.id);
    return true;
  }
  if (action === 'modremove') {
    if (!admin) {
      await replyError(interaction, '❌ Only admins can moderator-remove items.');
      return true;
    }
    softDeleteArtItem(db, interaction.guildId, item.id);
    recordModAction(db, interaction.guildId, item.id, interaction.user.id, 'remove');
    await interaction.update({
      content: `🛡 **#${item.id}** removed by moderator.`,
      embeds: [],
      components: [backToBrowseRow()],
    });
    await refreshDashboardMessage(interaction.client, interaction.guildId).catch(() => {});
    return true;
  }
  return false;
}

/**
 * Re-render the ephemeral message to show the same item after a status change.
 * Looks up the item's natural board context and navigates there.
 */
async function refreshFromItem(
  interaction: MessageComponentInteraction<'cached'>,
  itemId: number,
): Promise<void> {
  const item = getArtItem(db, interaction.guildId, itemId);
  if (!item) return;
  const items = listArtItems(db, interaction.guildId, { ownerId: item.ownerId, sort: 'new' });
  const page = Math.max(0, items.findIndex((i) => i.id === itemId));
  await showBoardView(interaction, item.ownerId, page, 'update');
  await refreshDashboardMessage(interaction.client, interaction.guildId).catch(() => {});
}

function backToBrowseRow(): DashboardRow {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(artBrowseBtnId())
      .setEmoji('🏠')
      .setLabel('Back to Browse')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(artMyBoardBtnId())
      .setEmoji('🖼')
      .setLabel('My Board')
      .setStyle(ButtonStyle.Primary),
  );
}

async function showUploadGuide(
  interaction: MessageComponentInteraction<'cached'>,
): Promise<boolean> {
  const embed = new EmbedBuilder()
    .setTitle('⬆️ Upload Art')
    .setColor(COLOR.PRIMARY)
    .setDescription(
      'Discord modals can\'t accept file attachments, so uploads go through a slash command.',
    )
    .addFields(
      {
        name: '1 · Run the command',
        value:
          '```/art upload file:<attach> title:My piece category:screenshot jam:1 tags:wip,boss```',
      },
      {
        name: '2 · We archive it',
        value:
          'The bot forwards the file to a private storage channel so your upload keeps working even after Discord\'s CDN URLs expire.',
      },
      {
        name: '3 · Browse it',
        value: 'Your upload shows up in **My Board**, the jam gallery (if set), and the Home summary.',
      },
    )
    .setFooter({
      text: 'Supported: PNG, JPEG, WebP, GIF, APNG, MP4, WebM, MOV · max 25 MB',
    });
  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function openBioModal(
  interaction: MessageComponentInteraction<'cached'>,
): Promise<boolean> {
  const board = getArtboard(db, interaction.guildId, interaction.user.id);
  const modal = new ModalBuilder()
    .setCustomId(artBioModalId())
    .setTitle('Edit artboard bio');
  const input = new TextInputBuilder()
    .setCustomId('bio')
    .setLabel('Bio (leave empty to clear)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(280)
    .setValue(board?.bio ?? '');
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input),
  );
  await interaction.showModal(modal);
  return true;
}

function buildEditArtModal(item: ArtItem): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(artEditModalId(item.id))
    .setTitle(`Edit item #${item.id}`);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Title')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
        .setValue(item.title),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('caption')
        .setLabel('Caption (leave empty to clear)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1800)
        .setValue(item.caption ?? ''),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('category')
        .setLabel(
          'Category — concept_art|ui|animation|environment|character|logo|screenshot|reference|other',
        )
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(20)
        .setValue(item.category ?? ''),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('tags')
        .setLabel('Tags (comma separated)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(120)
        .setValue(item.tags.join(', ')),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('jam')
        .setLabel('Jam ID (empty or 0 to clear)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(10)
        .setValue(item.jamId != null ? String(item.jamId) : ''),
    ),
  );
  return modal;
}

async function submitEditArt(
  interaction: ModalSubmitInteraction<'cached'>,
  itemId: number,
): Promise<void> {
  const item = getArtItem(db, interaction.guildId, itemId);
  if (!item || item.deletedAt) {
    await replyError(interaction, '❌ That item no longer exists.');
    return;
  }
  const admin = isAdminModal(interaction);
  const isOwner = interaction.user.id === item.ownerId;
  if (!(isOwner || admin)) {
    await replyError(interaction, '❌ Only the owner or an admin can edit this item.');
    return;
  }
  const title = interaction.fields.getTextInputValue('title').trim();
  const caption = interaction.fields.getTextInputValue('caption').trim() || null;
  const categoryRaw = interaction.fields.getTextInputValue('category').trim().toLowerCase();
  const category: ArtCategory | null = categoryRaw === ''
    ? null
    : isArtCategory(categoryRaw)
      ? categoryRaw
      : null;
  const tagsRaw = interaction.fields.getTextInputValue('tags');
  const tags = tagsRaw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && t.length <= 24)
    .slice(0, 10);
  const jamRaw = interaction.fields.getTextInputValue('jam').trim();
  const jamId = jamRaw === '' || jamRaw === '0' ? null : Number(jamRaw);

  const updated = updateArtItem(db, interaction.guildId, itemId, {
    title,
    caption,
    category,
    tags,
    jamId,
  });
  if (!updated) {
    await replyError(interaction, '❌ Update failed.');
    return;
  }
  await interaction.reply({
    content: `✅ Updated **#${updated.id}**.`,
    flags: MessageFlags.Ephemeral,
  });
  await refreshDashboardMessage(interaction.client, interaction.guildId).catch(() => {});
}

async function submitBio(interaction: ModalSubmitInteraction<'cached'>): Promise<void> {
  const raw = interaction.fields.getTextInputValue('bio').trim();
  const bio = raw === '' ? null : raw;
  setArtboardBio(db, interaction.guildId, interaction.user.id, bio);
  await interaction.reply({
    content: bio ? '✅ Bio updated.' : '✅ Bio cleared.',
    flags: MessageFlags.Ephemeral,
  });
  await refreshDashboardMessage(interaction.client, interaction.guildId).catch(() => {});
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
