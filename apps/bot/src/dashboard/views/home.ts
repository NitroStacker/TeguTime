import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import {
  getJamStatus,
  listArtItems,
  listBoardOwners,
  listJams,
  listJobs,
  listGuildTimezones,
  summarizeJobs,
} from '@tegutime/domain';
import {
  discordTimestamp,
  formatDurationShort,
  formatOffset,
  getOffsetMinutes,
} from '@tegutime/tz';
import { COLOR, JAM_STATUS_BADGE, JAM_STATUS_COLOR } from '../../render/theme';
import { buildNavigationRow } from '../nav';
import { homeAdminId, homeQuickId, refreshId } from '../ids';
import type { DashboardContext, DashboardView } from '../types';

function jamSummaryField(ctx: DashboardContext, now: number): { name: string; value: string } {
  const jams = listJams(ctx.db, ctx.guild.id);
  if (jams.length === 0) {
    return {
      name: '🎮 Current Jam',
      value: '_No jam scheduled. Admins: use the **Jam** tab to create one._',
    };
  }
  const primary =
    jams.find((j) => getJamStatus(j, now) === 'live') ??
    [...jams]
      .sort((a, b) => a.startsAtUtc - b.startsAtUtc)
      .find((j) => getJamStatus(j, now) === 'upcoming') ??
    jams[0];
  if (!primary) {
    return { name: '🎮 Current Jam', value: '_No jam._' };
  }
  const status = getJamStatus(primary, now);
  const badge = JAM_STATUS_BADGE[status];
  const when =
    status === 'upcoming'
      ? `Starts ${discordTimestamp(primary.startsAtUtc, 'R')} · ${discordTimestamp(primary.startsAtUtc, 'F')}`
      : status === 'live'
        ? `Ends ${discordTimestamp(primary.endsAtUtc, 'R')} · **${formatDurationShort(primary.endsAtUtc - now)}** left`
        : status === 'ended'
          ? `Ended ${discordTimestamp(primary.endsAtUtc, 'R')}`
          : 'Archived';
  return {
    name: '🎮 Current Jam',
    value: `**${primary.title}**\n${badge} · ${when}`,
  };
}

function progressBar(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round(clamped / 10);
  return '▰'.repeat(filled) + '▱'.repeat(10 - filled) + ` ${clamped}%`;
}

function jobsSummaryField(ctx: DashboardContext): { name: string; value: string } {
  const jobs = listJobs(ctx.db, ctx.guild.id, { jamId: 'any', includeArchived: false });
  if (jobs.length === 0) {
    return {
      name: '📋 Job Board',
      value: '_No jobs yet. Head to the **Jobs** tab to create one._',
    };
  }
  const s = summarizeJobs(jobs);
  const lines = [
    `${progressBar(s.completionPct)} · **${s.byStatus.complete}/${s.total}** complete`,
    `🟡 ${s.byStatus.in_progress} in progress · 🟠 ${s.byStatus.blocked} blocked · ⚪ ${s.byStatus.unassigned} unassigned`,
  ];
  if (s.overdue > 0) lines.push(`🚨 **${s.overdue}** overdue`);
  return { name: '📋 Job Board', value: lines.join('\n') };
}

function timezonesSummaryField(ctx: DashboardContext): { name: string; value: string } {
  const rows = listGuildTimezones(ctx.db, ctx.guild.id);
  if (rows.length === 0) {
    return {
      name: '🌍 Timezones',
      value: '_No members have set a timezone yet._',
    };
  }
  const byOffset = new Map<number, number>();
  for (const row of rows) {
    const o = getOffsetMinutes(row.timezone) ?? 0;
    byOffset.set(o, (byOffset.get(o) ?? 0) + 1);
  }
  const top = [...byOffset.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([o, n]) => `${formatOffset(o)} (${n})`)
    .join(' · ');
  return {
    name: '🌍 Timezones',
    value: `**${rows.length}** member${rows.length === 1 ? '' : 's'} configured\nTop zones: ${top}`,
  };
}

function artboardsSummaryField(ctx: DashboardContext): { name: string; value: string } {
  const items = listArtItems(ctx.db, ctx.guild.id);
  if (items.length === 0) {
    return {
      name: '🖼 Artboards',
      value: '_No art uploaded yet. Use `/art upload` or the **Artboards** tab._',
    };
  }
  const owners = listBoardOwners(ctx.db, ctx.guild.id);
  const latest = items[0];
  const lines = [
    `**${items.length}** upload${items.length === 1 ? '' : 's'} from **${owners.length}** contributor${owners.length === 1 ? '' : 's'}`,
  ];
  if (latest) {
    lines.push(`Latest: **${latest.title}** by <@${latest.ownerId}> · ${discordTimestamp(latest.createdAt, 'R')}`);
  }
  return { name: '🖼 Artboards', value: lines.join('\n') };
}

export function renderHome(ctx: DashboardContext): DashboardView {
  const now = Date.now();
  const jamField = jamSummaryField(ctx, now);
  const status = (() => {
    const jams = listJams(ctx.db, ctx.guild.id);
    const primary =
      jams.find((j) => getJamStatus(j, now) === 'live') ??
      [...jams]
        .sort((a, b) => a.startsAtUtc - b.startsAtUtc)
        .find((j) => getJamStatus(j, now) === 'upcoming') ??
      jams[0];
    return primary ? getJamStatus(primary, now) : null;
  })();

  const color = status ? JAM_STATUS_COLOR[status] : COLOR.PRIMARY;

  const embed = new EmbedBuilder()
    .setTitle(`🎛 ${ctx.guild.name} · TeguTime Dashboard`)
    .setColor(color)
    .setDescription(
      "Your server's control panel for jams, jobs, timezones, and artboards. " +
        'Switch tabs below — the dashboard updates in place.',
    )
    .addFields(
      jamField,
      jobsSummaryField(ctx),
      timezonesSummaryField(ctx),
      artboardsSummaryField(ctx),
    )
    .setFooter({ text: 'Refreshed' })
    .setTimestamp(new Date(now));

  const nav = buildNavigationRow('home', ctx.isAdmin);

  // Row 2: personal quick actions + (for admins) a shortcut to the admin panel.
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(refreshId())
      .setEmoji('🔄')
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(homeQuickId('board'))
      .setEmoji('📋')
      .setLabel('Job Board')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(homeQuickId('mine'))
      .setEmoji('📝')
      .setLabel('My Jobs')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(homeQuickId('mytz'))
      .setEmoji('🕒')
      .setLabel('My Timezone')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(homeAdminId())
      .setEmoji('⚙️')
      .setLabel('Admin')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!ctx.isAdmin),
  );

  return { embeds: [embed], components: [nav, actions] };
}
