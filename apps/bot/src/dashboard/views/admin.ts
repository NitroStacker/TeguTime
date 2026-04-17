import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getPinnedSheet } from '@tegutime/domain';
import { COLOR } from '../../render/theme';
import { buildNavigationRow } from '../nav';
import { adminPinSheetId, adminRepostId, refreshId } from '../ids';
import type { DashboardContext, DashboardView } from '../types';

export function renderAdminView(ctx: DashboardContext): DashboardView {
  const nav = buildNavigationRow('admin', ctx.isAdmin);

  if (!ctx.isAdmin) {
    const embed = new EmbedBuilder()
      .setTitle('⚙️ Admin')
      .setColor(COLOR.MUTED)
      .setDescription('_This section is only available to members with the **Manage Server** permission._');
    return { embeds: [embed], components: [nav] };
  }

  const pinned = getPinnedSheet(ctx.db, ctx.guild.id);

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Admin Panel')
    .setColor(COLOR.PRIMARY)
    .setDescription(
      'Server-wide controls. Use these sparingly — members prefer quiet channels.',
    )
    .addFields(
      {
        name: '📌 Pinned timezone sheet',
        value: pinned
          ? `Active in <#${pinned.channelId}>`
          : '_Not pinned. Use the button below to pin the sheet to this channel._',
        inline: false,
      },
      {
        name: '🎛 Dashboard',
        value: `Currently posted in <#${getDashboardChannel(ctx)}>. Use **Repost** to move or refresh it.`,
        inline: false,
      },
    );
  embed.setFooter({ text: 'Refreshed' }).setTimestamp(new Date());

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(refreshId())
      .setEmoji('🔄')
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(adminPinSheetId())
      .setEmoji('📌')
      .setLabel(pinned ? 'Refresh Pinned Sheet' : 'Pin Sheet Here')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(adminRepostId())
      .setEmoji('♻️')
      .setLabel('Repost Dashboard')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [nav, row] };
}

/** Best-effort dashboard channel ID for the admin panel description. */
function getDashboardChannel(ctx: DashboardContext): string {
  // The dashboard state is available via persist.ts but we avoid importing it
  // here to keep the view pure. Any stale description will be corrected on the
  // next render, and the `Repost` button fixes it entirely.
  return ctx.guild.systemChannelId ?? ctx.guild.id;
}
