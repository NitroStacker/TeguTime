import { EmbedBuilder } from 'discord.js';
import {
  type Job,
  type JobStatus,
  type JobPriority,
  type JobSummary,
  summarizeJobs,
  type JamRow,
} from '@tegutime/domain';
import { discordTimestamp } from '@tegutime/tz';
import {
  COLOR,
  JOB_STATUS_BADGE,
  JOB_STATUS_ORDER,
  PRIORITY_BADGE,
  PRIORITY_ORDER,
} from './theme';

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function statusColor(status: JobStatus): number {
  switch (status) {
    case 'in_progress':
      return COLOR.UPCOMING;
    case 'blocked':
      return 0xed8936;
    case 'complete':
      return COLOR.SUCCESS;
    case 'cancelled':
      return COLOR.MUTED;
    default:
      return COLOR.PRIMARY;
  }
}

function isOverdue(job: Job, now: number): boolean {
  return (
    job.dueAtUtc != null &&
    job.dueAtUtc < now &&
    job.status !== 'complete' &&
    job.status !== 'cancelled'
  );
}

export function renderJobEmbed(job: Job, now: number = Date.now()): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`#${job.id} · ${truncate(job.title, 240)}`)
    .setColor(statusColor(job.status as JobStatus));

  if (job.description) {
    embed.setDescription(truncate(job.description, 2000));
  }

  const metaTop: string[] = [
    `**Status:** ${JOB_STATUS_BADGE[job.status as JobStatus]}`,
    `**Priority:** ${PRIORITY_BADGE[job.priority as JobPriority]}`,
  ];
  if (job.category) metaTop.push(`**Category:** ${job.category}`);
  if (job.jamId != null) metaTop.push(`**Jam:** #${job.jamId}`);
  embed.addFields({ name: 'Overview', value: metaTop.join('\n'), inline: false });

  const metaBottom: string[] = [];
  metaBottom.push(
    `👤 **Assignee:** ${job.assigneeId ? `<@${job.assigneeId}>` : '_none_'}`,
  );
  if (job.dueAtUtc != null) {
    const overdue = isOverdue(job, now) ? ' 🚨 **overdue**' : '';
    metaBottom.push(
      `📅 **Due:** ${discordTimestamp(job.dueAtUtc, 'F')} (${discordTimestamp(job.dueAtUtc, 'R')})${overdue}`,
    );
  }
  if (job.tags.length > 0) {
    metaBottom.push(`🏷 **Tags:** ${job.tags.map((t) => `\`${t}\``).join(' ')}`);
  }
  embed.addFields({ name: 'Details', value: metaBottom.join('\n'), inline: false });

  embed.setFooter({
    text: `Created by ${job.createdBy} · Updated`,
  });
  embed.setTimestamp(new Date(job.updatedAt));

  return embed;
}

// ---- Board view ----

export interface JobBoardOptions {
  title?: string;
  jam?: JamRow | null;
  scope?: string; // e.g. "All jobs" or "Your jobs" or "Filtered: blocked"
}

function priorityMarker(p: JobPriority): string {
  return p === 'urgent' ? '🚨 ' : p === 'high' ? '⬆ ' : '';
}

function jobLine(job: Job, now: number): string {
  const overdue = isOverdue(job, now) ? ' 🚨' : '';
  const assignee = job.assigneeId ? ` · <@${job.assigneeId}>` : '';
  const due = job.dueAtUtc != null ? ` · ${discordTimestamp(job.dueAtUtc, 'R')}` : '';
  return `${priorityMarker(job.priority as JobPriority)}**#${job.id}** ${truncate(
    job.title,
    60,
  )}${assignee}${due}${overdue}`;
}

function progressBar(summary: JobSummary): string {
  const pct = Math.max(0, Math.min(100, summary.completionPct));
  const filled = Math.round(pct / 10);
  return '▰'.repeat(filled) + '▱'.repeat(10 - filled) + ` ${pct}%`;
}

export function renderJobBoardEmbed(
  jobs: Job[],
  opts: JobBoardOptions = {},
  now: number = Date.now(),
): EmbedBuilder[] {
  const title = opts.title ?? '📋 Job Board';
  const summary = summarizeJobs(jobs, now);

  if (jobs.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(COLOR.PRIMARY)
      .setDescription('_No jobs to show. Create one with `/job create`._');
    if (opts.scope) embed.setFooter({ text: opts.scope });
    return [embed];
  }

  // Group by status in a sensible order, then sort each group by priority then update time.
  const byStatus = new Map<JobStatus, Job[]>();
  for (const j of jobs) {
    const list = byStatus.get(j.status as JobStatus) ?? [];
    list.push(j);
    byStatus.set(j.status as JobStatus, list);
  }
  for (const [, list] of byStatus) {
    list.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority as JobPriority];
      const pb = PRIORITY_ORDER[b.priority as JobPriority];
      if (pa !== pb) return pa - pb;
      return b.updatedAt - a.updatedAt;
    });
  }

  const summaryLines = [
    `${progressBar(summary)} · **${summary.byStatus.complete}/${summary.total}** complete`,
    `🟡 In progress: **${summary.byStatus.in_progress}** · 🟠 Blocked: **${summary.byStatus.blocked}** · 🔵 Assigned: **${summary.byStatus.assigned}** · ⚪ Unassigned: **${summary.byStatus.unassigned}**`,
  ];
  if (summary.overdue > 0) summaryLines.push(`🚨 **${summary.overdue}** overdue`);
  if (opts.jam) summaryLines.unshift(`🎮 **${opts.jam.title}** (Jam #${opts.jam.id})`);

  const header = new EmbedBuilder()
    .setTitle(title)
    .setColor(COLOR.PRIMARY)
    .setDescription(summaryLines.join('\n'));
  if (opts.scope) header.setFooter({ text: opts.scope });

  // Per-status field groupings, packed into additional embeds if we overflow.
  const embeds: EmbedBuilder[] = [header];
  let current = header;
  let currentFieldCount = 0;
  const maxFieldsPerEmbed = 25;
  const maxFieldLen = 1024;

  for (const status of JOB_STATUS_ORDER) {
    const list = byStatus.get(status);
    if (!list || list.length === 0) continue;

    let chunk = '';
    let chunkIndex = 1;
    const chunks: string[] = [];
    for (const job of list) {
      const line = jobLine(job, now) + '\n';
      if (chunk.length + line.length > maxFieldLen) {
        chunks.push(chunk.trimEnd());
        chunk = '';
      }
      chunk += line;
    }
    if (chunk) chunks.push(chunk.trimEnd());

    for (const c of chunks) {
      const label =
        chunks.length > 1
          ? `${JOB_STATUS_BADGE[status]} (${chunkIndex++}/${chunks.length}) · ${list.length}`
          : `${JOB_STATUS_BADGE[status]} · ${list.length}`;

      if (currentFieldCount >= maxFieldsPerEmbed) {
        current = new EmbedBuilder().setColor(COLOR.PRIMARY);
        embeds.push(current);
        currentFieldCount = 0;
      }
      current.addFields({ name: label, value: c, inline: false });
      currentFieldCount += 1;
    }
  }

  const last = embeds[embeds.length - 1];
  if (last) last.setTimestamp(new Date());
  return embeds.slice(0, 10);
}
