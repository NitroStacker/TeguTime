import { EmbedBuilder } from 'discord.js';
import {
  type ArtItem,
  type ArtCategory,
  type ArtboardRow,
  type BoardOwnerSummary,
  type JamGallerySummary,
  type MediaType,
  ART_CATEGORIES,
} from '@tegutime/domain';
import { discordTimestamp } from '@tegutime/tz';
import { COLOR } from './theme';

function truncate(s: string | null | undefined, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export const CATEGORY_LABEL: Record<ArtCategory, string> = {
  concept_art: '🎨 Concept Art',
  ui: '🧱 UI',
  animation: '🎞 Animation',
  environment: '🌄 Environment',
  character: '🧝 Character',
  logo: '🔷 Logo',
  screenshot: '📸 Screenshot',
  reference: '📎 Reference',
  other: '✨ Other',
};

const MEDIA_BADGE: Record<MediaType, string> = {
  image: '🖼 Image',
  gif: '🌀 GIF',
  video: '🎬 Video',
};

function mediaBadge(media: string): string {
  return MEDIA_BADGE[media as MediaType] ?? media;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Render a single art item as its detail card. `freshUrl` is the result of
 * `freshUrlFor(...)` — pass null if we couldn't re-sign (shows a broken link
 * fallback instead of silent blank).
 */
export function renderArtItemEmbed(
  item: ArtItem,
  freshUrl: string | null,
  opts: { position?: { index: number; total: number }; jamTitle?: string | null } = {},
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`🎨 ${truncate(item.title, 240)}`)
    .setColor(item.featured ? 0xf1c40f : COLOR.PRIMARY);

  if (item.caption) embed.setDescription(truncate(item.caption, 2000));

  const topMeta: string[] = [
    `👤 <@${item.ownerId}>`,
    mediaBadge(item.mediaType),
  ];
  if (item.category) topMeta.push(CATEGORY_LABEL[item.category as ArtCategory] ?? item.category);
  if (item.featured) topMeta.push('⭐ Featured');
  embed.addFields({ name: 'Overview', value: topMeta.join(' · '), inline: false });

  const fileLine = `\`${item.filename}\` · ${formatFileSize(item.fileSizeBytes)}${
    item.width && item.height ? ` · ${item.width}×${item.height}` : ''
  }`;
  const jamLine =
    item.jamId != null ? `🎮 ${opts.jamTitle ?? `Jam #${item.jamId}`}` : null;
  const tagLine = item.tags.length
    ? `🏷 ${item.tags.map((t) => `\`${t}\``).join(' ')}`
    : null;

  const details = [fileLine, jamLine, tagLine].filter(Boolean).join('\n');
  if (details) embed.addFields({ name: 'Details', value: details, inline: false });

  if (freshUrl && item.mediaType !== 'video') {
    embed.setImage(freshUrl);
  }
  // For videos, the caller should also attach the file to the message so
  // Discord's inline player renders. We add a visible "Watch" link here as
  // a graceful fallback if the attach ever fails.
  if (freshUrl && item.mediaType === 'video') {
    embed.addFields({
      name: 'Video',
      value: `▶ [Watch ${item.filename}](${freshUrl})`,
      inline: false,
    });
  }

  const footer = opts.position
    ? `Item ${opts.position.index + 1} / ${opts.position.total} · Uploaded`
    : 'Uploaded';
  embed.setFooter({ text: footer }).setTimestamp(new Date(item.createdAt));

  return embed;
}

/**
 * Build the `files` array for an interaction response when an item is a
 * video — attaching the file makes Discord show its native inline player
 * underneath the embed. Returns `[]` for non-video items so callers can
 * always pass the result through unchanged (and clear any stale video
 * attachment when navigating to a non-video item).
 */
export function attachmentsForItem(
  item: ArtItem,
  freshUrl: string | null,
): Array<{ attachment: string; name: string }> {
  if (item.mediaType !== 'video' || !freshUrl) return [];
  return [{ attachment: freshUrl, name: item.filename }];
}

/**
 * Render a "my board / user board" landing card when the viewer hasn't yet
 * drilled into a specific item. Shows bio, counts, latest contributions, and
 * the featured piece if set.
 *
 * `ownerName` is the display name we want to show in the title (embed titles
 * don't render `<@id>` mentions, so the caller must resolve it beforehand).
 */
export function renderBoardLandingEmbed(
  ownerId: string,
  ownerName: string,
  board: ArtboardRow | null,
  items: ArtItem[],
  freshUrlForFeatured: string | null,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`🖼 ${ownerName}'s Artboard`)
    .setColor(COLOR.PRIMARY);

  const lines: string[] = [];
  if (board?.bio) lines.push(`> _${truncate(board.bio, 300)}_`);
  lines.push(`**${items.length}** item${items.length === 1 ? '' : 's'} uploaded.`);
  if (items.length > 0) {
    lines.push(`Most recent: ${discordTimestamp(items[0]!.createdAt, 'R')}`);
  }
  embed.setDescription(lines.join('\n\n'));

  const featured = items.find((i) => i.featured && i.id === board?.featuredItemId);
  if (featured) {
    embed.addFields({
      name: '⭐ Featured',
      value: `**${truncate(featured.title, 100)}**\n${CATEGORY_LABEL[featured.category as ArtCategory] ?? ''}`,
      inline: false,
    });
    if (freshUrlForFeatured && featured.mediaType !== 'video') {
      embed.setImage(freshUrlForFeatured);
    }
  } else if (items.length > 0) {
    const latest = items[0]!;
    embed.addFields({
      name: '🆕 Latest upload',
      value: `**${truncate(latest.title, 100)}**`,
      inline: false,
    });
  }

  embed.setFooter({ text: 'Use the navigation below to browse items' }).setTimestamp(new Date());
  return embed;
}

/**
 * Summary card for the "pick a board" browse screen.
 */
export function renderBrowseDirectoryEmbed(
  summaries: BoardOwnerSummary[],
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('🖼 Artboards')
    .setColor(COLOR.PRIMARY);

  if (summaries.length === 0) {
    embed.setDescription('_No one has uploaded art yet. Use `/art upload` to be the first._');
    return embed;
  }

  const lines = summaries
    .slice(0, 15)
    .map(
      (s, i) =>
        `**${i + 1}.** <@${s.userId}> — ${s.itemCount} item${s.itemCount === 1 ? '' : 's'} · latest ${discordTimestamp(s.latestAt, 'R')}`,
    )
    .join('\n');

  embed.setDescription(
    `**${summaries.length}** contributor${summaries.length === 1 ? '' : 's'}:\n\n${lines}`,
  );
  embed.setFooter({ text: 'Pick a creator below to view their board' });
  return embed;
}

export function renderJamGalleryEmbed(
  jamTitle: string | null,
  summary: JamGallerySummary,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`🎮 ${jamTitle ? `${jamTitle} — Gallery` : 'Jam Gallery'}`)
    .setColor(COLOR.PRIMARY);

  if (summary.total === 0) {
    embed.setDescription('_No uploads for this jam yet. Be the first with `/art upload`._');
    return embed;
  }

  const lines: string[] = [
    `**${summary.total}** upload${summary.total === 1 ? '' : 's'} from **${summary.distinctOwners}** creator${summary.distinctOwners === 1 ? '' : 's'}`,
  ];
  if (summary.featured.length > 0) {
    const featured = summary.featured
      .map((i) => `⭐ **${truncate(i.title, 50)}** — <@${i.ownerId}>`)
      .join('\n');
    lines.push('', featured);
  }
  if (summary.latest.length > 0) {
    const latest = summary.latest
      .map((i) => `• **${truncate(i.title, 50)}** — <@${i.ownerId}> · ${discordTimestamp(i.createdAt, 'R')}`)
      .join('\n');
    lines.push('', '**Recent uploads:**', latest);
  }
  embed.setDescription(lines.join('\n'));
  embed.setFooter({ text: 'Pick an item below to view full detail' });
  return embed;
}

export { ART_CATEGORIES };
