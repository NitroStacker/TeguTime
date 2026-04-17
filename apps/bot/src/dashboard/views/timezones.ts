import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { getUserTimezone, listGuildTimezones } from '@tegutime/domain';
import { formatLabel, formatOffset, getCurrentTime, getOffsetMinutes } from '@tegutime/tz';
import { COLOR } from '../../render/theme';
import { buildNavigationRow } from '../nav';
import {
  refreshId,
  tzRemoveBtnId,
  tzSearchBtnId,
  tzSetBtnId,
  tzSheetBtnId,
} from '../ids';
import type { DashboardContext, DashboardView } from '../types';

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function renderTimezonesView(ctx: DashboardContext): DashboardView {
  const embed = new EmbedBuilder().setTitle('🌍 Timezones').setColor(COLOR.PRIMARY);

  const currentTz = getUserTimezone(ctx.db, ctx.guild.id, ctx.forUserId);
  const yourLine = currentTz
    ? `Your zone: **${formatLabel(currentTz)}** · local time **${getCurrentTime(currentTz)}**`
    : '_You have not set a timezone yet. Click **Set Mine** to choose one._';

  embed.setDescription(
    `${yourLine}\n\nThe server's timezone sheet is available below; admins can also pin a live-updating copy to any channel from the **Admin** tab.`,
  );

  const rows = listGuildTimezones(ctx.db, ctx.guild.id);
  if (rows.length > 0) {
    const byOffset = new Map<number, number>();
    for (const row of rows) {
      const o = getOffsetMinutes(row.timezone) ?? 0;
      byOffset.set(o, (byOffset.get(o) ?? 0) + 1);
    }
    const top = [...byOffset.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([o, n]) => `${formatOffset(o)} × ${n}`)
      .join(' · ');

    // Preview the 8 most recent rows — a teaser of the full sheet.
    const preview = rows.slice(0, 8);
    const previewLines = preview
      .map((r) => `• <@${r.userId}> — ${formatLabel(r.timezone)}`)
      .join('\n');

    embed.addFields(
      {
        name: `Server zones · ${rows.length} configured`,
        value: top || '_—_',
        inline: false,
      },
      {
        name: rows.length > 8 ? `Preview · first 8 of ${rows.length}` : 'Members',
        value: truncate(previewLines, 1024),
        inline: false,
      },
    );
  }
  embed.setFooter({ text: 'Refreshed' }).setTimestamp(new Date());

  const nav = buildNavigationRow('timezones', ctx.isAdmin);

  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(refreshId())
      .setEmoji('🔄')
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(tzSetBtnId())
      .setEmoji('🕒')
      .setLabel(currentTz ? 'Change Mine' : 'Set Mine')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(tzSearchBtnId())
      .setEmoji('🔎')
      .setLabel('Search by city')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(tzRemoveBtnId())
      .setEmoji('🗑')
      .setLabel('Remove Mine')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!currentTz),
    new ButtonBuilder()
      .setCustomId(tzSheetBtnId())
      .setEmoji('📜')
      .setLabel('Full Sheet')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [nav, actions] };
}
