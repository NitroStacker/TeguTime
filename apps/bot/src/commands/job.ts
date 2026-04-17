import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import {
  createJob,
  editJob,
  deleteJob,
  archiveJob,
  unarchiveJob,
  assignJob,
  unassignJob,
  setJobStatus,
  addJobComment,
  listJobComments,
  getJob,
  listJobs,
  canTransitionJobStatus,
  canEditJob,
  JOB_PRIORITIES,
  JOB_STATUSES,
  isJobPriority,
  isJobStatus,
  type Job,
  type JobStatus,
  type JobPriority,
  type JamRow,
  getJam,
  listJams,
} from '@tegutime/domain';
import { parseDateTimeInZone } from '@tegutime/tz';
import { db } from '../db';
import { isAdmin } from '../permissions';
import { renderJobEmbed, renderJobBoardEmbed } from '../render/jobEmbed';
import { TIME_FORMAT_HINT } from './jam';

function guildJamOrNull(guildId: string, id: number | null): JamRow | null {
  if (id == null) return null;
  return getJam(db, guildId, id);
}

export const data = new SlashCommandBuilder()
  .setName('job')
  .setDescription('Jam job board — coordinate tasks across your team')
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Create a new job')
      .addStringOption((o) => o.setName('title').setDescription('Short title').setRequired(true))
      .addStringOption((o) =>
        o.setName('description').setDescription('Optional longer description').setRequired(false),
      )
      .addStringOption((o) =>
        o.setName('category').setDescription('e.g. "art", "code", "music"').setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName('priority')
          .setDescription('How urgent is this?')
          .addChoices(...JOB_PRIORITIES.map((p) => ({ name: p, value: p })))
          .setRequired(false),
      )
      .addUserOption((o) =>
        o.setName('assignee').setDescription('Assign to a member').setRequired(false),
      )
      .addIntegerOption((o) =>
        o
          .setName('jam')
          .setDescription('Associated jam')
          .setRequired(false)
          .setAutocomplete(true),
      )
      .addStringOption((o) =>
        o
          .setName('due')
          .setDescription('Due date (UTC) — ' + TIME_FORMAT_HINT)
          .setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName('tags')
          .setDescription('Comma-separated tags (e.g. "2d,enemy,boss")')
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('edit')
      .setDescription('Edit a job you created (or any job with Manage Server)')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Job ID').setRequired(true).setAutocomplete(true),
      )
      .addStringOption((o) => o.setName('title').setDescription('New title').setRequired(false))
      .addStringOption((o) =>
        o.setName('description').setDescription('New description').setRequired(false),
      )
      .addStringOption((o) =>
        o.setName('category').setDescription('New category').setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName('priority')
          .setDescription('New priority')
          .addChoices(...JOB_PRIORITIES.map((p) => ({ name: p, value: p })))
          .setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName('due')
          .setDescription('New due date — ' + TIME_FORMAT_HINT + ', empty string clears')
          .setRequired(false),
      )
      .addStringOption((o) =>
        o.setName('tags').setDescription('New tags (comma-separated)').setRequired(false),
      )
      .addIntegerOption((o) =>
        o
          .setName('jam')
          .setDescription('Associated jam (0 to clear)')
          .setRequired(false)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('delete')
      .setDescription('Delete a job (creator or Manage Server)')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Job ID').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('archive')
      .setDescription('Archive a completed job')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Job ID').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('reopen')
      .setDescription('Reopen an archived or completed job')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Job ID').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('assign')
      .setDescription('Assign a job to a member (Manage Server)')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Job ID').setRequired(true).setAutocomplete(true),
      )
      .addUserOption((o) =>
        o.setName('user').setDescription('Who to assign').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('claim')
      .setDescription('Claim an unassigned job (assigns it to you)')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Job ID').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('unclaim')
      .setDescription('Remove yourself from a job you currently hold')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Job ID').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('start')
      .setDescription('Mark a job as in progress (assignee or admin)')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Job ID').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('block')
      .setDescription('Mark a job as blocked (assignee or admin)')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Job ID').setRequired(true).setAutocomplete(true),
      )
      .addStringOption((o) =>
        o.setName('reason').setDescription('What is blocking it?').setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('complete')
      .setDescription('Mark a job complete (assignee or admin)')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Job ID').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('cancel')
      .setDescription('Mark a job cancelled (creator or admin)')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Job ID').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('view')
      .setDescription('View a job in detail')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Job ID').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('board')
      .setDescription('Show the full job board')
      .addIntegerOption((o) =>
        o
          .setName('jam')
          .setDescription('Filter to a specific jam')
          .setRequired(false)
          .setAutocomplete(true),
      )
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('Filter by status')
          .addChoices(...JOB_STATUSES.map((s) => ({ name: s, value: s })))
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('Compact list view (same filters as board)')
      .addIntegerOption((o) =>
        o
          .setName('jam')
          .setDescription('Filter to a specific jam')
          .setRequired(false)
          .setAutocomplete(true),
      )
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('Filter by status')
          .addChoices(...JOB_STATUSES.map((s) => ({ name: s, value: s })))
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('mine').setDescription('Show the jobs assigned to you'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('comment')
      .setDescription('Add a comment to a job')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Job ID').setRequired(true).setAutocomplete(true),
      )
      .addStringOption((o) =>
        o.setName('text').setDescription('Comment text').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('history')
      .setDescription('Show comments on a job')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Job ID').setRequired(true).setAutocomplete(true),
      ),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused(true);
  const q = String(focused.value).trim().toLowerCase();

  if (focused.name === 'id') {
    const jobs = listJobs(db, interaction.guildId, { includeArchived: true });
    const matches = jobs
      .filter((j) => !q || String(j.id) === q || j.title.toLowerCase().includes(q))
      .slice(0, 25)
      .map((j) => ({
        name: `#${j.id} · ${j.title}`.slice(0, 100),
        value: j.id,
      }));
    await interaction.respond(matches);
    return;
  }
  if (focused.name === 'jam') {
    const jams = listJams(db, interaction.guildId, { includeArchived: true });
    const matches = jams
      .filter((j) => !q || String(j.id) === q || j.title.toLowerCase().includes(q))
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
    case 'reopen':
      return handleReopen(interaction);
    case 'assign':
      return handleAssign(interaction);
    case 'claim':
      return handleClaim(interaction);
    case 'unclaim':
      return handleUnclaim(interaction);
    case 'start':
      return handleTransition(interaction, 'in_progress');
    case 'block':
      return handleBlock(interaction);
    case 'complete':
      return handleTransition(interaction, 'complete');
    case 'cancel':
      return handleCancel(interaction);
    case 'view':
      return handleView(interaction);
    case 'board':
      return handleBoard(interaction);
    case 'list':
      return handleBoard(interaction); // same renderer; scope differs only in title
    case 'mine':
      return handleMine(interaction);
    case 'comment':
      return handleComment(interaction);
    case 'history':
      return handleHistory(interaction);
  }
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 10);
}

async function handleCreate(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const title = interaction.options.getString('title', true).trim();
  const description = interaction.options.getString('description')?.trim() || null;
  const category = interaction.options.getString('category')?.trim() || null;
  const priorityStr = interaction.options.getString('priority');
  const priority: JobPriority =
    priorityStr && isJobPriority(priorityStr) ? priorityStr : 'normal';
  const assignee = interaction.options.getUser('assignee');
  const jamId = interaction.options.getInteger('jam');
  const dueStr = interaction.options.getString('due')?.trim() || null;
  const tagsRaw = interaction.options.getString('tags');

  let dueAtUtc: number | null = null;
  if (dueStr) {
    const jam = guildJamOrNull(interaction.guildId, jamId);
    const tz = jam?.timezone ?? 'UTC';
    dueAtUtc = parseDateTimeInZone(dueStr, tz);
    if (dueAtUtc == null) {
      await interaction.reply({
        content: `❌ Invalid due date. Use ${TIME_FORMAT_HINT}. Interpreted in ${tz}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  if (jamId != null && !guildJamOrNull(interaction.guildId, jamId)) {
    await interaction.reply({
      content: `❌ No jam with id \`${jamId}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (assignee?.bot) {
    await interaction.reply({
      content: '❌ Bots cannot be assigned jobs.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const job = createJob(db, {
    guildId: interaction.guildId,
    title,
    description,
    category,
    priority,
    assigneeId: assignee?.id ?? null,
    jamId: jamId ?? null,
    dueAtUtc,
    tags: parseTags(tagsRaw),
    createdBy: interaction.user.id,
  });

  await interaction.reply({
    content: `✅ Job **#${job.id}** created.`,
    embeds: [renderJobEmbed(job)],
  });
}

async function handleEdit(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const jobId = interaction.options.getInteger('id', true);
  const job = getJob(db, interaction.guildId, jobId);
  if (!job) return notFound(interaction, jobId);

  if (!canEditJob(job, interaction.user.id, isAdmin(interaction))) {
    await interaction.reply({
      content: '❌ Only the creator or a server admin can edit this job.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const priorityStr = interaction.options.getString('priority');
  const priority =
    priorityStr && isJobPriority(priorityStr) ? priorityStr : undefined;

  const dueStr = interaction.options.getString('due');
  let dueAtUtc: number | null | undefined;
  if (dueStr != null) {
    if (dueStr === '') {
      dueAtUtc = null;
    } else {
      const jam = guildJamOrNull(interaction.guildId, job.jamId);
      const tz = jam?.timezone ?? 'UTC';
      dueAtUtc = parseDateTimeInZone(dueStr, tz);
      if (dueAtUtc == null) {
        await interaction.reply({
          content: `❌ Invalid due date. Use ${TIME_FORMAT_HINT}, or empty string to clear.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }
  }

  const jamIdOpt = interaction.options.getInteger('jam');
  let jamId: number | null | undefined;
  if (jamIdOpt != null) {
    if (jamIdOpt === 0) {
      jamId = null;
    } else if (!guildJamOrNull(interaction.guildId, jamIdOpt)) {
      await interaction.reply({
        content: `❌ No jam with id \`${jamIdOpt}\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    } else {
      jamId = jamIdOpt;
    }
  }

  const tagsRaw = interaction.options.getString('tags');
  const updated = editJob(db, interaction.guildId, jobId, {
    title: interaction.options.getString('title') ?? undefined,
    description: interaction.options.getString('description') ?? undefined,
    category: interaction.options.getString('category') ?? undefined,
    priority,
    dueAtUtc,
    tags: tagsRaw == null ? undefined : parseTags(tagsRaw),
    jamId,
  });
  if (!updated) return notFound(interaction, jobId);
  await interaction.reply({
    content: `✅ Job **#${updated.id}** updated.`,
    embeds: [renderJobEmbed(updated)],
  });
}

async function handleDelete(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const jobId = interaction.options.getInteger('id', true);
  const job = getJob(db, interaction.guildId, jobId);
  if (!job) return notFound(interaction, jobId);
  if (!canEditJob(job, interaction.user.id, isAdmin(interaction))) {
    await interaction.reply({
      content: '❌ Only the creator or a server admin can delete this job.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  deleteJob(db, interaction.guildId, jobId);
  await interaction.reply({
    content: `🗑 Job **#${jobId}** deleted.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleArchive(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const jobId = interaction.options.getInteger('id', true);
  const job = getJob(db, interaction.guildId, jobId);
  if (!job) return notFound(interaction, jobId);
  if (!canEditJob(job, interaction.user.id, isAdmin(interaction))) {
    await interaction.reply({
      content: '❌ Only the creator or a server admin can archive this job.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const result = archiveJob(db, interaction.guildId, jobId);
  if (!result) return notFound(interaction, jobId);
  await interaction.reply({
    content: `🗂 Job **#${result.id}** archived.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleReopen(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const jobId = interaction.options.getInteger('id', true);
  const job = getJob(db, interaction.guildId, jobId);
  if (!job) return notFound(interaction, jobId);
  if (!canEditJob(job, interaction.user.id, isAdmin(interaction))) {
    await interaction.reply({
      content: '❌ Only the creator or a server admin can reopen this job.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  let result: Job | null = job;
  if (job.archivedAt != null) result = unarchiveJob(db, interaction.guildId, jobId);
  if (!result) return notFound(interaction, jobId);
  const newStatus: JobStatus = result.assigneeId ? 'assigned' : 'unassigned';
  const final = setJobStatus(db, interaction.guildId, jobId, newStatus) ?? result;
  await interaction.reply({
    content: `🔁 Job **#${final.id}** reopened.`,
    embeds: [renderJobEmbed(final)],
  });
}

async function handleAssign(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ Only **Manage Server** can directly assign jobs. Members can `claim` unassigned jobs.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const jobId = interaction.options.getInteger('id', true);
  const user = interaction.options.getUser('user', true);
  if (user.bot) {
    await interaction.reply({
      content: '❌ Bots cannot be assigned jobs.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const job = getJob(db, interaction.guildId, jobId);
  if (!job) return notFound(interaction, jobId);
  const updated = assignJob(db, interaction.guildId, jobId, user.id);
  if (!updated) return notFound(interaction, jobId);
  await interaction.reply({
    content: `✅ Job **#${updated.id}** assigned to ${user}.`,
    embeds: [renderJobEmbed(updated)],
  });
}

async function handleClaim(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const jobId = interaction.options.getInteger('id', true);
  const job = getJob(db, interaction.guildId, jobId);
  if (!job) return notFound(interaction, jobId);
  if (job.assigneeId && job.assigneeId !== interaction.user.id) {
    await interaction.reply({
      content: `❌ Job **#${job.id}** is already claimed by <@${job.assigneeId}>.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const updated = assignJob(db, interaction.guildId, jobId, interaction.user.id);
  if (!updated) return notFound(interaction, jobId);
  await interaction.reply({
    content: `✅ ${interaction.user} claimed job **#${updated.id}**.`,
    embeds: [renderJobEmbed(updated)],
  });
}

async function handleUnclaim(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const jobId = interaction.options.getInteger('id', true);
  const job = getJob(db, interaction.guildId, jobId);
  if (!job) return notFound(interaction, jobId);
  if (job.assigneeId !== interaction.user.id && !isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ You can only unclaim jobs assigned to you (admins can unclaim any).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const updated = unassignJob(db, interaction.guildId, jobId);
  if (!updated) return notFound(interaction, jobId);
  await interaction.reply({
    content: `✅ Job **#${updated.id}** is now unassigned.`,
    embeds: [renderJobEmbed(updated)],
  });
}

async function handleTransition(
  interaction: ChatInputCommandInteraction<'cached'>,
  status: JobStatus,
): Promise<void> {
  const jobId = interaction.options.getInteger('id', true);
  const job = getJob(db, interaction.guildId, jobId);
  if (!job) return notFound(interaction, jobId);
  if (!canTransitionJobStatus(job, interaction.user.id, isAdmin(interaction))) {
    await interaction.reply({
      content: `❌ Only the assignee or an admin can change status on **#${job.id}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const updated = setJobStatus(db, interaction.guildId, jobId, status);
  if (!updated) return notFound(interaction, jobId);
  const verb: Record<JobStatus, string> = {
    unassigned: 'reset',
    assigned: 'marked as assigned',
    in_progress: 'is now **in progress**',
    blocked: 'marked as **blocked**',
    complete: 'marked **complete**',
    cancelled: 'marked **cancelled**',
  };
  await interaction.reply({
    content: `✅ Job **#${updated.id}** ${verb[status]}.`,
    embeds: [renderJobEmbed(updated)],
  });
}

async function handleBlock(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const jobId = interaction.options.getInteger('id', true);
  const reason = interaction.options.getString('reason')?.trim() || null;
  const job = getJob(db, interaction.guildId, jobId);
  if (!job) return notFound(interaction, jobId);
  if (!canTransitionJobStatus(job, interaction.user.id, isAdmin(interaction))) {
    await interaction.reply({
      content: `❌ Only the assignee or an admin can block **#${job.id}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const updated = setJobStatus(db, interaction.guildId, jobId, 'blocked');
  if (!updated) return notFound(interaction, jobId);
  if (reason) {
    addJobComment(db, jobId, interaction.user.id, `[blocked] ${reason}`);
  }
  await interaction.reply({
    content: `🟠 Job **#${updated.id}** marked as **blocked**${reason ? ' — reason logged.' : '.'}`,
    embeds: [renderJobEmbed(updated)],
  });
}

async function handleCancel(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const jobId = interaction.options.getInteger('id', true);
  const job = getJob(db, interaction.guildId, jobId);
  if (!job) return notFound(interaction, jobId);
  if (!canEditJob(job, interaction.user.id, isAdmin(interaction))) {
    await interaction.reply({
      content: '❌ Only the creator or a server admin can cancel this job.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const updated = setJobStatus(db, interaction.guildId, jobId, 'cancelled');
  if (!updated) return notFound(interaction, jobId);
  await interaction.reply({
    content: `⚫ Job **#${updated.id}** cancelled.`,
    embeds: [renderJobEmbed(updated)],
  });
}

async function handleView(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const jobId = interaction.options.getInteger('id', true);
  const job = getJob(db, interaction.guildId, jobId);
  if (!job) return notFound(interaction, jobId);
  await interaction.reply({ embeds: [renderJobEmbed(job)] });
}

async function handleBoard(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const jamId = interaction.options.getInteger('jam');
  const statusStr = interaction.options.getString('status');
  const status = statusStr && isJobStatus(statusStr) ? statusStr : undefined;

  const jam = jamId != null ? guildJamOrNull(interaction.guildId, jamId) : null;
  const jobs = listJobs(db, interaction.guildId, {
    jamId: jamId ?? 'any',
    status,
    includeArchived: false,
  });

  const scopeBits: string[] = [];
  if (jam) scopeBits.push(`Jam #${jam.id}`);
  if (status) scopeBits.push(`Status: ${status}`);
  const scope = scopeBits.length ? `Filtered: ${scopeBits.join(' · ')}` : 'All open jobs';

  const embeds = renderJobBoardEmbed(jobs, { title: '📋 Job Board', jam, scope });
  await interaction.reply({ embeds });
}

async function handleMine(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const jobs = listJobs(db, interaction.guildId, {
    jamId: 'any',
    assigneeId: interaction.user.id,
    includeArchived: false,
  });
  const embeds = renderJobBoardEmbed(jobs, { title: `📋 Your Jobs`, scope: `${interaction.user.tag}` });
  await interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
}

async function handleComment(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const jobId = interaction.options.getInteger('id', true);
  const text = interaction.options.getString('text', true).trim();
  if (!text) {
    await interaction.reply({
      content: '❌ Comment text is empty.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const job = getJob(db, interaction.guildId, jobId);
  if (!job) return notFound(interaction, jobId);
  addJobComment(db, jobId, interaction.user.id, text.slice(0, 1500));
  await interaction.reply({
    content: `💬 Comment added to job **#${jobId}**.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleHistory(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const jobId = interaction.options.getInteger('id', true);
  const job = getJob(db, interaction.guildId, jobId);
  if (!job) return notFound(interaction, jobId);
  const comments = listJobComments(db, jobId);
  if (comments.length === 0) {
    await interaction.reply({
      content: `_No comments on job **#${jobId}** yet._`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const lines = comments
    .slice(-20)
    .map((c) => `<t:${Math.floor(c.createdAt / 1000)}:R> · <@${c.userId}> — ${c.content}`)
    .join('\n')
    .slice(0, 3500);
  await interaction.reply({
    content: `**Comments on #${jobId}**\n${lines}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function notFound(
  interaction: ChatInputCommandInteraction<'cached'>,
  jobId: number,
): Promise<void> {
  await interaction.reply({
    content: `❌ No job with id \`${jobId}\` in this server.`,
    flags: MessageFlags.Ephemeral,
  });
}
