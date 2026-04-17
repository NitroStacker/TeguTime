import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import {
  getJamStatus,
  listArtItems,
  listBoardOwners,
  listJams,
  summarizeJamGallery,
} from '@tegutime/domain';
import { discordTimestamp } from '@tegutime/tz';
import { COLOR } from '../../render/theme';
import { buildNavigationRow } from '../nav';
import {
  artBrowseBtnId,
  artJamBtnId,
  artMyBoardBtnId,
  artUploadBtnId,
  refreshId,
} from '../ids';
import type { DashboardContext, DashboardView } from '../types';

export function renderArtboardsView(ctx: DashboardContext): DashboardView {
  const now = Date.now();
  const nav = buildNavigationRow('artboards', ctx.isAdmin);

  const allItems = listArtItems(ctx.db, ctx.guild.id);
  const owners = listBoardOwners(ctx.db, ctx.guild.id);

  const embed = new EmbedBuilder()
    .setTitle('🖼 Artboards')
    .setColor(COLOR.PRIMARY);

  if (allItems.length === 0) {
    embed.setDescription(
      'No art uploaded yet.\n\n' +
        'Use **Upload Art** below (or `/art upload`) to add the first piece. Attach a file directly in the slash command — Discord doesn\'t let modals accept files.',
    );
  } else {
    const contributors = owners
      .slice(0, 5)
      .map((o) => `<@${o.userId}> (${o.itemCount})`)
      .join(' · ');
    const featured = allItems.filter((i) => i.featured).slice(0, 3);
    const featuredLine =
      featured.length > 0
        ? '\n\n⭐ **Featured:** ' +
          featured
            .map((f) => `**${f.title}** by <@${f.ownerId}>`)
            .join(' · ')
        : '';

    embed.setDescription(
      `**${allItems.length}** upload${allItems.length === 1 ? '' : 's'} · **${owners.length}** contributor${owners.length === 1 ? '' : 's'}\n\n` +
        `**Latest contributors:** ${contributors}${featuredLine}`,
    );
  }

  // Current jam summary — if there's an active jam, show its gallery snapshot.
  const jams = listJams(ctx.db, ctx.guild.id);
  const activeJam =
    jams.find((j) => getJamStatus(j, now) === 'live') ??
    [...jams]
      .sort((a, b) => b.startsAtUtc - a.startsAtUtc)
      .find((j) => getJamStatus(j, now) === 'ended');
  if (activeJam) {
    const jamSummary = summarizeJamGallery(ctx.db, ctx.guild.id, activeJam.id);
    embed.addFields({
      name: `🎮 ${activeJam.title} — jam gallery`,
      value:
        jamSummary.total === 0
          ? '_No uploads for this jam yet._'
          : `**${jamSummary.total}** upload${jamSummary.total === 1 ? '' : 's'} from **${jamSummary.distinctOwners}** creator${jamSummary.distinctOwners === 1 ? '' : 's'}` +
            (jamSummary.latest[0]
              ? `\nLatest: **${jamSummary.latest[0].title}** by <@${jamSummary.latest[0].ownerId}> · ${discordTimestamp(jamSummary.latest[0].createdAt, 'R')}`
              : ''),
      inline: false,
    });
  }

  const recentItems = allItems.slice(0, 6);
  if (recentItems.length > 0) {
    const lines = recentItems
      .map(
        (i) =>
          `**#${i.id}** · ${i.title} — <@${i.ownerId}> · ${discordTimestamp(i.createdAt, 'R')}`,
      )
      .join('\n');
    embed.addFields({ name: '🆕 Recent uploads', value: lines, inline: false });
  }

  embed.setFooter({ text: 'Refreshed' }).setTimestamp(new Date(now));

  const primary = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(refreshId())
      .setEmoji('🔄')
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(artMyBoardBtnId())
      .setEmoji('🖼')
      .setLabel('My Board')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(artBrowseBtnId())
      .setEmoji('🔎')
      .setLabel('Browse')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(owners.length === 0),
    new ButtonBuilder()
      .setCustomId(artJamBtnId())
      .setEmoji('🎮')
      .setLabel('Jam Gallery')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(jams.length === 0),
    new ButtonBuilder()
      .setCustomId(artUploadBtnId())
      .setEmoji('⬆️')
      .setLabel('Upload Art')
      .setStyle(ButtonStyle.Success),
  );

  return { embeds: [embed], components: [nav, primary] };
}
