import { EmbedBuilder } from 'discord.js';
import {
  type JamRow,
  type JamReminderRow,
  type ReminderKind,
  getJamStatus,
} from '@tegutime/domain';
import {
  discordTimestamp,
  formatDurationShort,
  formatInAuthoredZone,
  formatLabel,
} from '@tegutime/tz';
import { COLOR, JAM_STATUS_BADGE, JAM_STATUS_COLOR } from './theme';

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function elapsedOrRemaining(jam: JamRow, now: number): string {
  const status = getJamStatus(jam, now);
  switch (status) {
    case 'upcoming':
      return `Starts in **${formatDurationShort(jam.startsAtUtc - now)}**`;
    case 'live': {
      const elapsed = now - jam.startsAtUtc;
      const remaining = jam.endsAtUtc - now;
      return `**${formatDurationShort(elapsed)}** elapsed · **${formatDurationShort(remaining)}** remaining`;
    }
    case 'ended': {
      const ago = now - jam.endsAtUtc;
      return `Ended **${formatDurationShort(ago)}** ago`;
    }
    case 'archived':
      return 'Archived';
  }
}

/**
 * Render a single jam as a polished detail embed.
 */
export function renderJamEmbed(jam: JamRow, now: number = Date.now()): EmbedBuilder {
  const status = getJamStatus(jam, now);
  const badge = JAM_STATUS_BADGE[status];
  const color = JAM_STATUS_COLOR[status];

  const embed = new EmbedBuilder()
    .setTitle(`🎮 ${truncate(jam.title, 240)}`)
    .setColor(color);

  if (jam.description) {
    embed.setDescription(truncate(jam.description, 2000));
  }

  embed.addFields(
    {
      name: 'Status',
      value: `${badge}\n${elapsedOrRemaining(jam, now)}`,
      inline: false,
    },
    {
      name: '⏱ Starts',
      value: `${discordTimestamp(jam.startsAtUtc, 'F')}\n${discordTimestamp(
        jam.startsAtUtc,
        'R',
      )} · \`${formatInAuthoredZone(jam.startsAtUtc, jam.timezone)}\``,
      inline: true,
    },
    {
      name: '🏁 Ends',
      value: `${discordTimestamp(jam.endsAtUtc, 'F')}\n${discordTimestamp(
        jam.endsAtUtc,
        'R',
      )} · \`${formatInAuthoredZone(jam.endsAtUtc, jam.timezone)}\``,
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

  embed.setFooter({
    text: `Jam #${jam.id} • Created by user ${jam.createdBy}`,
  });
  embed.setTimestamp(new Date(jam.updatedAt));

  return embed;
}

/**
 * Render a compact list of jams (for /jam list).
 */
export function renderJamList(jams: JamRow[], now: number = Date.now()): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle('🎮 Game Jams').setColor(COLOR.PRIMARY);

  if (jams.length === 0) {
    embed.setDescription('_No jams yet. Create one with `/jam create`._');
    return embed;
  }

  const live = jams.filter((j) => getJamStatus(j, now) === 'live');
  const upcoming = jams.filter((j) => getJamStatus(j, now) === 'upcoming');
  const ended = jams.filter((j) => getJamStatus(j, now) === 'ended');
  const archived = jams.filter((j) => getJamStatus(j, now) === 'archived');

  const line = (j: JamRow) =>
    `**#${j.id}** · ${truncate(j.title, 60)} — ${discordTimestamp(j.startsAtUtc, 'R')}`;

  if (live.length) {
    embed.addFields({
      name: `${JAM_STATUS_BADGE.live} · ${live.length}`,
      value: live.map(line).join('\n').slice(0, 1024),
      inline: false,
    });
  }
  if (upcoming.length) {
    embed.addFields({
      name: `${JAM_STATUS_BADGE.upcoming} · ${upcoming.length}`,
      value: upcoming.map(line).join('\n').slice(0, 1024),
      inline: false,
    });
  }
  if (ended.length) {
    embed.addFields({
      name: `${JAM_STATUS_BADGE.ended} · ${ended.length}`,
      value: ended.slice(0, 5).map(line).join('\n').slice(0, 1024),
      inline: false,
    });
  }
  if (archived.length) {
    embed.addFields({
      name: `${JAM_STATUS_BADGE.archived} · ${archived.length}`,
      value: archived.slice(0, 5).map(line).join('\n').slice(0, 1024),
      inline: false,
    });
  }

  embed.setFooter({ text: `${jams.length} jam${jams.length === 1 ? '' : 's'} total` });
  return embed;
}

// ---- Reminder dispatch content ----

const REMINDER_COPY: Record<ReminderKind, { title: string; body: (j: JamRow) => string }> = {
  start: {
    title: '🚀 Jam is live!',
    body: (j) => `**${j.title}** has started. Good luck!`,
  },
  halfway: {
    title: '⏱ Halfway there',
    body: (j) =>
      `**${j.title}** is at the halfway mark. You have ${discordTimestamp(j.endsAtUtc, 'R')}.`,
  },
  '24h_before_end': {
    title: '⏰ 24 hours to go',
    body: (j) => `**${j.title}** ends ${discordTimestamp(j.endsAtUtc, 'R')}.`,
  },
  '1h_before_end': {
    title: '⚡ Final hour',
    body: (j) => `**${j.title}** ends in under an hour — wrap it up!`,
  },
  end: {
    title: '🏁 Jam has ended',
    body: (j) => `**${j.title}** is complete. Great work, everyone!`,
  },
};

export function renderReminderContent(
  jam: JamRow,
  reminder: JamReminderRow,
): { content: string; embeds: EmbedBuilder[] } {
  const copy = REMINDER_COPY[reminder.kind as ReminderKind];
  const content = jam.participantRoleId ? `<@&${jam.participantRoleId}>` : '';

  const embed = new EmbedBuilder()
    .setTitle(copy?.title ?? 'Jam update')
    .setColor(JAM_STATUS_COLOR[getJamStatus(jam)])
    .setDescription(copy?.body(jam) ?? `Update for **${jam.title}**.`)
    .setFooter({ text: `Jam #${jam.id}` })
    .setTimestamp(new Date());

  return { content, embeds: [embed] };
}
