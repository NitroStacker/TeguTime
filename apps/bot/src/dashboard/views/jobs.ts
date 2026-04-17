import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import {
  JOB_STATUSES,
  listJams,
  listJobs,
  summarizeJobs,
  type Job,
  type JobStatus,
  type JobPriority,
} from '@tegutime/domain';
import { discordTimestamp } from '@tegutime/tz';
import {
  COLOR,
  JOB_STATUS_BADGE,
  JOB_STATUS_ORDER,
  PRIORITY_BADGE,
  PRIORITY_ORDER,
} from '../../render/theme';
import { buildNavigationRow } from '../nav';
import {
  jobsCreateBtnId,
  jobsJamSelectId,
  jobsMineBtnId,
  jobsPageNextId,
  jobsPagePrevId,
  jobsPickSelectId,
  jobsStatusSelectId,
  refreshId,
} from '../ids';
import { getJobsFilter } from '../session';
import type { DashboardContext, DashboardView } from '../types';

const PAGE_SIZE = 10;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function progressBar(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round(clamped / 10);
  return '▰'.repeat(filled) + '▱'.repeat(10 - filled) + ` ${clamped}%`;
}

function priorityMarker(p: JobPriority): string {
  return p === 'urgent' ? '🚨 ' : p === 'high' ? '⬆ ' : '';
}

function jobLine(job: Job, now: number): string {
  const overdue =
    job.dueAtUtc != null &&
    job.dueAtUtc < now &&
    job.status !== 'complete' &&
    job.status !== 'cancelled'
      ? ' 🚨'
      : '';
  const assignee = job.assigneeId ? ` · <@${job.assigneeId}>` : '';
  const due =
    job.dueAtUtc != null ? ` · ${discordTimestamp(job.dueAtUtc, 'R')}` : '';
  return `${priorityMarker(job.priority as JobPriority)}**#${job.id}** ${truncate(
    job.title,
    60,
  )}${assignee}${due}${overdue}`;
}

export function renderJobsView(ctx: DashboardContext): DashboardView {
  const now = Date.now();
  const filter = getJobsFilter(ctx.guild.id);
  const statusFilter: JobStatus | undefined =
    filter.status === 'all' ? undefined : filter.status;
  const jamFilter = filter.jamId;

  const jobs = listJobs(ctx.db, ctx.guild.id, {
    jamId: jamFilter,
    status: statusFilter,
    includeArchived: false,
  });

  const summary = summarizeJobs(jobs, now);
  const totalPages = Math.max(1, Math.ceil(jobs.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, filter.page), totalPages);
  const start = (page - 1) * PAGE_SIZE;

  // Sort: by status (in_progress first), then priority, then recency
  const sorted = [...jobs].sort((a, b) => {
    const sa = JOB_STATUS_ORDER.indexOf(a.status as JobStatus);
    const sb = JOB_STATUS_ORDER.indexOf(b.status as JobStatus);
    if (sa !== sb) return sa - sb;
    const pa = PRIORITY_ORDER[a.priority as JobPriority];
    const pb = PRIORITY_ORDER[b.priority as JobPriority];
    if (pa !== pb) return pa - pb;
    return b.updatedAt - a.updatedAt;
  });
  const pageJobs = sorted.slice(start, start + PAGE_SIZE);

  // Embed — status summary on top, jobs grouped below
  const embed = new EmbedBuilder().setTitle('📋 Job Board').setColor(COLOR.PRIMARY);

  if (jobs.length === 0) {
    embed.setDescription(
      filter.status === 'all' && filter.jamId === 'any'
        ? '_No jobs yet. Click **Create** to add the first one._'
        : '_No jobs match the current filters._',
    );
  } else {
    const lines: string[] = [
      `${progressBar(summary.completionPct)} · **${summary.byStatus.complete}/${summary.total}** complete`,
      `🟡 ${summary.byStatus.in_progress} in progress · 🟠 ${summary.byStatus.blocked} blocked · 🔵 ${summary.byStatus.assigned} assigned · ⚪ ${summary.byStatus.unassigned} unassigned`,
    ];
    if (summary.overdue > 0) lines.push(`🚨 **${summary.overdue}** overdue`);
    embed.setDescription(lines.join('\n'));

    // Group pageJobs by status for field display
    const grouped = new Map<JobStatus, Job[]>();
    for (const j of pageJobs) {
      const list = grouped.get(j.status as JobStatus) ?? [];
      list.push(j);
      grouped.set(j.status as JobStatus, list);
    }
    for (const status of JOB_STATUS_ORDER) {
      const group = grouped.get(status);
      if (!group || group.length === 0) continue;
      const value = group.map((j) => jobLine(j, now)).join('\n').slice(0, 1024);
      embed.addFields({
        name: `${JOB_STATUS_BADGE[status]} · ${group.length}`,
        value,
        inline: false,
      });
    }
  }

  const activeFilters: string[] = [];
  if (filter.status !== 'all') activeFilters.push(`status: ${filter.status}`);
  if (filter.jamId !== 'any')
    activeFilters.push(filter.jamId === null ? 'no jam' : `jam #${filter.jamId}`);
  const footer = activeFilters.length
    ? `Filtered by ${activeFilters.join(' · ')} · Page ${page}/${totalPages}`
    : `All open jobs · Page ${page}/${totalPages}`;
  embed.setFooter({ text: footer }).setTimestamp(new Date(now));

  // Row 1 nav
  const nav = buildNavigationRow('jobs', ctx.isAdmin);

  // Row 2 status filter
  const statusSelect = new StringSelectMenuBuilder()
    .setCustomId(jobsStatusSelectId())
    .setPlaceholder('Filter by status…')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('All statuses')
        .setValue('all')
        .setEmoji('🔁')
        .setDefault(filter.status === 'all'),
      ...JOB_STATUSES.map((s) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(s)
          .setValue(s)
          .setDescription(JOB_STATUS_BADGE[s])
          .setDefault(filter.status === s),
      ),
    );

  // Row 3 jam filter
  const jams = listJams(ctx.db, ctx.guild.id, { includeArchived: true });
  const jamSelect = new StringSelectMenuBuilder()
    .setCustomId(jobsJamSelectId())
    .setPlaceholder('Filter by jam…')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('All jams')
        .setValue('any')
        .setEmoji('🎮')
        .setDefault(filter.jamId === 'any'),
      new StringSelectMenuOptionBuilder()
        .setLabel('No jam association')
        .setValue('none')
        .setEmoji('➖')
        .setDefault(filter.jamId === null),
      ...jams.slice(0, 23).map((j) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(truncate(`#${j.id} · ${j.title}`, 100))
          .setValue(`j:${j.id}`)
          .setDefault(filter.jamId === j.id),
      ),
    );

  // Row 4: pagination + actions
  const actionsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(refreshId())
      .setEmoji('🔄')
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(jobsPagePrevId(page))
      .setEmoji('◀')
      .setLabel('Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(jobsPageNextId(page))
      .setEmoji('▶')
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages),
    new ButtonBuilder()
      .setCustomId(jobsCreateBtnId())
      .setEmoji('➕')
      .setLabel('Create')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(jobsMineBtnId())
      .setEmoji('📝')
      .setLabel('My Jobs')
      .setStyle(ButtonStyle.Primary),
  );

  // Row 5: pick a job
  const pickRow: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
  if (pageJobs.length > 0) {
    const pickSelect = new StringSelectMenuBuilder()
      .setCustomId(jobsPickSelectId())
      .setPlaceholder('Pick a job to act on…')
      .addOptions(
        pageJobs.slice(0, 25).map((j) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(truncate(`#${j.id} · ${j.title}`, 100))
            .setValue(String(j.id))
            .setDescription(
              `${JOB_STATUS_BADGE[j.status as JobStatus]} · ${PRIORITY_BADGE[j.priority as JobPriority]}`.slice(
                0,
                100,
              ),
            ),
        ),
      );
    pickRow.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(pickSelect),
    );
  }

  return {
    embeds: [embed],
    components: [
      nav,
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(statusSelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(jamSelect),
      actionsRow,
      ...pickRow,
    ],
  };
}
