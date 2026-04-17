import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { getJam, getJamStatus, listJams, type JamRow } from '@tegutime/domain';
import { discordTimestamp, formatDurationShort, formatLabel } from '@tegutime/tz';
import { COLOR, JAM_STATUS_BADGE, JAM_STATUS_COLOR } from '../../render/theme';
import { buildNavigationRow } from '../nav';
import {
  jamArchiveBtnId,
  jamCreateBtnId,
  jamDetailsBtnId,
  jamEditBtnId,
  jamFocusSelectId,
  refreshId,
} from '../ids';
import type { DashboardContext, DashboardView } from '../types';

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function pickFocusedJam(jams: JamRow[], requestedId: number | null): JamRow | null {
  if (requestedId != null) {
    const match = jams.find((j) => j.id === requestedId);
    if (match) return match;
  }
  const now = Date.now();
  return (
    jams.find((j) => getJamStatus(j, now) === 'live') ??
    [...jams]
      .sort((a, b) => a.startsAtUtc - b.startsAtUtc)
      .find((j) => getJamStatus(j, now) === 'upcoming') ??
    jams[0] ??
    null
  );
}

function jamDetailEmbed(jam: JamRow, now: number): EmbedBuilder {
  const status = getJamStatus(jam, now);
  const embed = new EmbedBuilder()
    .setTitle(`🎮 ${truncate(jam.title, 240)}`)
    .setColor(JAM_STATUS_COLOR[status]);

  if (jam.description) embed.setDescription(truncate(jam.description, 2000));

  const whenLine = (() => {
    if (status === 'upcoming') {
      return `${JAM_STATUS_BADGE.upcoming} · Starts in **${formatDurationShort(jam.startsAtUtc - now)}**`;
    }
    if (status === 'live') {
      const elapsed = now - jam.startsAtUtc;
      const remaining = jam.endsAtUtc - now;
      return `${JAM_STATUS_BADGE.live} · **${formatDurationShort(elapsed)}** elapsed · **${formatDurationShort(remaining)}** remaining`;
    }
    if (status === 'ended') {
      return `${JAM_STATUS_BADGE.ended} · Ended **${formatDurationShort(now - jam.endsAtUtc)}** ago`;
    }
    return JAM_STATUS_BADGE.archived;
  })();

  embed.addFields(
    { name: 'Status', value: whenLine, inline: false },
    {
      name: '⏱ Starts',
      value: `${discordTimestamp(jam.startsAtUtc, 'F')}\n${discordTimestamp(jam.startsAtUtc, 'R')}`,
      inline: true,
    },
    {
      name: '🏁 Ends',
      value: `${discordTimestamp(jam.endsAtUtc, 'F')}\n${discordTimestamp(jam.endsAtUtc, 'R')}`,
      inline: true,
    },
  );

  if (jam.submissionDeadlineUtc != null) {
    embed.addFields({
      name: '📮 Submissions due',
      value: `${discordTimestamp(jam.submissionDeadlineUtc, 'F')} (${discordTimestamp(jam.submissionDeadlineUtc, 'R')})`,
      inline: false,
    });
  }
  if (jam.votingDeadlineUtc != null) {
    embed.addFields({
      name: '🗳 Voting closes',
      value: `${discordTimestamp(jam.votingDeadlineUtc, 'F')} (${discordTimestamp(jam.votingDeadlineUtc, 'R')})`,
      inline: false,
    });
  }

  const meta: string[] = [`🌍 ${formatLabel(jam.timezone)}`];
  if (jam.announcementChannelId) meta.push(`📢 <#${jam.announcementChannelId}>`);
  if (jam.participantRoleId) meta.push(`👥 <@&${jam.participantRoleId}>`);
  embed.addFields({ name: 'Details', value: meta.join('\n'), inline: false });

  embed.setFooter({ text: `Jam #${jam.id}` }).setTimestamp(new Date(now));
  return embed;
}

export function renderJamView(ctx: DashboardContext): DashboardView {
  const now = Date.now();
  const allJams = listJams(ctx.db, ctx.guild.id, { includeArchived: true });
  const nav = buildNavigationRow('jam', ctx.isAdmin);

  if (allJams.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('🎮 Game Jams')
      .setColor(COLOR.PRIMARY)
      .setDescription(
        ctx.isAdmin
          ? 'No jams yet. Click **Create Jam** to schedule your first one.'
          : 'No jams scheduled yet. Ask an admin to create one.',
      );
    const createRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(refreshId())
        .setEmoji('🔄')
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(jamCreateBtnId())
        .setEmoji('➕')
        .setLabel('Create Jam')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!ctx.isAdmin),
    );
    return { embeds: [embed], components: [nav, createRow] };
  }

  const focused = pickFocusedJam(allJams, ctx.focusedJamId);
  const embeds: EmbedBuilder[] = focused
    ? [jamDetailEmbed(focused, now)]
    : [
        new EmbedBuilder()
          .setTitle('🎮 Game Jams')
          .setColor(COLOR.PRIMARY)
          .setDescription('Select a jam below.'),
      ];

  // Row 2: select jam to focus
  const select = new StringSelectMenuBuilder()
    .setCustomId(jamFocusSelectId())
    .setPlaceholder('Switch focused jam…')
    .addOptions(
      allJams.slice(0, 25).map((j) => {
        const status = getJamStatus(j, now);
        return new StringSelectMenuOptionBuilder()
          .setLabel(truncate(j.title, 100))
          .setValue(String(j.id))
          .setDescription(`#${j.id} · ${JAM_STATUS_BADGE[status].replace(/^[^ ]+ /, '')}`)
          .setDefault(focused?.id === j.id);
      }),
    );
  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  // Row 3: actions
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(refreshId())
      .setEmoji('🔄')
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
  );
  if (focused) {
    actions.addComponents(
      new ButtonBuilder()
        .setCustomId(jamDetailsBtnId(focused.id))
        .setEmoji('🔍')
        .setLabel('Details')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(jamEditBtnId(focused.id))
        .setEmoji('✏️')
        .setLabel('Edit')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!ctx.isAdmin),
      new ButtonBuilder()
        .setCustomId(jamArchiveBtnId(focused.id))
        .setEmoji('🗂')
        .setLabel('Archive')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!ctx.isAdmin || focused.archivedAt != null),
    );
  }
  actions.addComponents(
    new ButtonBuilder()
      .setCustomId(jamCreateBtnId())
      .setEmoji('➕')
      .setLabel('Create')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!ctx.isAdmin),
  );

  return { embeds, components: [nav, selectRow, actions] };
}

export { jamDetailEmbed };
export function getFocusedJam(ctx: DashboardContext, fallbackId: number | null): JamRow | null {
  const list = listJams(ctx.db, ctx.guild.id, { includeArchived: true });
  return pickFocusedJam(list, fallbackId);
}
export function resolveJam(ctx: DashboardContext, id: number): JamRow | null {
  return getJam(ctx.db, ctx.guild.id, id);
}
