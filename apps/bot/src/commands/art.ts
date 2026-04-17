import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  ART_CATEGORIES,
  createArtItem,
  classifyMedia,
  getArtItem,
  getArtboard,
  getJam,
  isArtCategory,
  listArtItems,
  listBoardOwners,
  listJams,
  recordModAction,
  setArtStorageChannel,
  setArtboardBio,
  setArtboardFeatured,
  softDeleteArtItem,
  updateArtItem,
  type ArtCategory,
  type ArtItem,
} from '@tegutime/domain';
import { db } from '../db';
import { isAdmin } from '../permissions';
import {
  ArtStorageNotConfigured,
  MAX_UPLOAD_BYTES,
  rehostAttachment,
  freshUrlFor,
} from '../artStorage';
import {
  CATEGORY_LABEL,
  renderArtItemEmbed,
  renderBoardLandingEmbed,
  renderBrowseDirectoryEmbed,
  renderJamGalleryEmbed,
} from '../render/artEmbed';
import { refreshDashboardMessage } from '../dashboard';
import { resolveDisplayName } from '../userNames';

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && t.length <= 24)
    .slice(0, 10);
}

function canEditItem(item: ArtItem, userId: string, admin: boolean): boolean {
  if (admin) return true;
  return item.ownerId === userId;
}

export const data = new SlashCommandBuilder()
  .setName('art')
  .setDescription('Artboard — your per-server media gallery')
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription('Designate the storage channel for uploaded art')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Private channel where the bot archives uploads')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('upload')
      .setDescription('Upload a piece of art/media to your board')
      // Discord requires every required option before any optional one.
      .addAttachmentOption((o) =>
        o.setName('file').setDescription('Image, GIF, or video (≤25 MB)').setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('title').setDescription('Title of the piece').setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('jam')
          .setDescription('Associated jam (pick "No jam" to keep it unassociated)')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((o) =>
        o.setName('caption').setDescription('Optional description').setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName('category')
          .setDescription('Category')
          .addChoices(...ART_CATEGORIES.map((c) => ({ name: c, value: c })))
          .setRequired(false),
      )
      .addStringOption((o) =>
        o.setName('tags').setDescription('Comma-separated tags').setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('my-board').setDescription('Open your own artboard'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('browse')
      .setDescription('Browse another member\'s artboard')
      .addUserOption((o) => o.setName('user').setDescription('Which member').setRequired(false)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('jam-gallery')
      .setDescription('Browse the gallery of art for a specific jam')
      .addIntegerOption((o) =>
        o.setName('jam').setDescription('Jam ID').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('edit')
      .setDescription('Edit metadata on one of your uploads')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Art item ID').setRequired(true).setAutocomplete(true),
      )
      .addStringOption((o) => o.setName('title').setDescription('New title').setRequired(false))
      .addStringOption((o) =>
        o.setName('caption').setDescription('New caption').setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName('category')
          .setDescription('New category')
          .addChoices(...ART_CATEGORIES.map((c) => ({ name: c, value: c })))
          .setRequired(false),
      )
      .addStringOption((o) =>
        o.setName('tags').setDescription('Comma-separated tags').setRequired(false),
      )
      .addIntegerOption((o) =>
        o
          .setName('jam')
          .setDescription('Associate with a jam (0 to clear)')
          .setRequired(false)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('delete')
      .setDescription('Delete one of your uploads (admins can delete any)')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Art item ID').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('bio')
      .setDescription('Set (or clear) the bio on your artboard')
      .addStringOption((o) =>
        o.setName('text').setDescription('Bio text (empty to clear)').setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('feature')
      .setDescription('Mark one of your uploads as your featured piece (0 to clear)')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('Art item ID (0 clears)').setRequired(true).setAutocomplete(true),
      ),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused(true);
  const q = String(focused.value).trim().toLowerCase();

  if (focused.name === 'jam') {
    const jams = listJams(db, interaction.guildId, { includeArchived: true });
    const results: Array<{ name: string; value: number }> = [];

    // Always include a "No jam" sentinel so the option can satisfy a required
    // jam field without forcing association.
    if (!q || 'none'.startsWith(q) || 'no jam'.includes(q) || q === '0') {
      results.push({ name: '➖ No jam (unassociated)', value: 0 });
    }

    for (const j of jams) {
      if (q && !(String(j.id) === q || j.title.toLowerCase().includes(q))) continue;
      results.push({ name: `#${j.id} · ${j.title}`.slice(0, 100), value: j.id });
      if (results.length >= 25) break;
    }
    await interaction.respond(results.slice(0, 25));
    return;
  }
  if (focused.name === 'id') {
    const ownerOnly = interaction.options.getSubcommand() !== 'delete' || !isAdmin(interaction as unknown as ChatInputCommandInteraction);
    const items = listArtItems(db, interaction.guildId, {
      ownerId: ownerOnly ? interaction.user.id : undefined,
    });
    const matches = items
      .filter((i) => !q || String(i.id) === q || i.title.toLowerCase().includes(q))
      .slice(0, 25)
      .map((i) => ({
        name: `#${i.id} · ${i.title}`.slice(0, 100),
        value: i.id,
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
    case 'setup':
      return handleSetup(interaction);
    case 'upload':
      return handleUpload(interaction);
    case 'my-board':
      return handleMyBoard(interaction);
    case 'browse':
      return handleBrowse(interaction);
    case 'jam-gallery':
      return handleJamGallery(interaction);
    case 'edit':
      return handleEdit(interaction);
    case 'delete':
      return handleDelete(interaction);
    case 'bio':
      return handleBio(interaction);
    case 'feature':
      return handleFeature(interaction);
  }
}

async function handleSetup(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: '❌ You need **Manage Server** to configure the storage channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const channel = interaction.options.getChannel('channel', true);
  const me = await interaction.guild.members.fetchMe();
  const guildChannel = await interaction.guild.channels.fetch(channel.id).catch(() => null);
  if (!guildChannel || !guildChannel.isTextBased()) {
    await interaction.reply({
      content: '❌ Invalid channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const perms = guildChannel.permissionsFor(me);
  const needed = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.EmbedLinks,
  ];
  if (needed.some((p) => !perms?.has(p))) {
    await interaction.reply({
      content: `❌ I need **View Channel**, **Send Messages**, **Attach Files**, **Read Message History**, and **Embed Links** in ${channel}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  setArtStorageChannel(db, interaction.guildId, channel.id);
  await interaction.reply({
    content:
      `✅ Artboard storage set to ${channel}. Uploads will be archived there.\n` +
      '_Tip: make this channel private so member uploads aren\'t duplicated publicly._',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleUpload(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const file = interaction.options.getAttachment('file', true);
  const title = interaction.options.getString('title', true).trim();
  const caption = interaction.options.getString('caption')?.trim() || null;
  const categoryStr = interaction.options.getString('category');
  const category: ArtCategory | null = categoryStr && isArtCategory(categoryStr) ? categoryStr : null;
  // `jam` is required; 0 is the "No jam" sentinel we surface in autocomplete.
  const jamOpt = interaction.options.getInteger('jam', true);
  const jamId: number | null = jamOpt === 0 ? null : jamOpt;
  const tags = parseTags(interaction.options.getString('tags'));

  if (file.size > MAX_UPLOAD_BYTES) {
    await interaction.reply({
      content: `❌ File is too large (${Math.round(file.size / 1024)} KB > 25 MB).`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const media = classifyMedia(file.contentType ?? '');
  if (!media) {
    await interaction.reply({
      content: `❌ Unsupported file type \`${file.contentType ?? 'unknown'}\`. Use PNG/JPEG/WebP/GIF or MP4/WebM/MOV.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (jamId != null && !getJam(db, interaction.guildId, jamId)) {
    await interaction.reply({
      content: `❌ No jam with id \`${jamId}\`. Pick from the autocomplete or choose **No jam**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const rehosted = await rehostAttachment(interaction.guild, file);
    const item = createArtItem(db, {
      guildId: interaction.guildId,
      ownerId: interaction.user.id,
      jamId: jamId ?? null,
      storageChannelId: rehosted.storageChannelId,
      storageMessageId: rehosted.storageMessageId,
      storageAttachmentId: rehosted.storageAttachmentId,
      filename: rehosted.filename,
      mediaType: media,
      contentType: rehosted.contentType,
      fileSizeBytes: rehosted.size,
      width: rehosted.width,
      height: rehosted.height,
      title,
      caption,
      category,
      tags,
    });

    await interaction.editReply({
      content: `✅ Uploaded as **#${item.id} · ${item.title}**. View it on the dashboard → Artboards → My Board, or with \`/art my-board\`.`,
      embeds: [renderArtItemEmbed(item, rehosted.url)],
    });
    await refreshDashboardMessage(interaction.client, interaction.guildId).catch(() => {});
  } catch (err) {
    if (err instanceof ArtStorageNotConfigured) {
      await interaction.editReply({
        content:
          '❌ Artboard is not set up yet. An admin needs to run `/art setup channel:<channel>` first.',
      });
      return;
    }
    console.error('[art] upload failed:', err);
    await interaction.editReply({
      content: `❌ Upload failed: ${err instanceof Error ? err.message : 'unknown error'}.`,
    });
  }
}

async function handleMyBoard(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  await sendBoardLanding(interaction, interaction.user.id);
}

async function handleBrowse(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const user = interaction.options.getUser('user');
  if (user) return sendBoardLanding(interaction, user.id);

  const boards = listBoardOwners(db, interaction.guildId);
  await interaction.reply({
    embeds: [renderBrowseDirectoryEmbed(boards)],
    flags: MessageFlags.Ephemeral,
  });
}

async function sendBoardLanding(
  interaction: ChatInputCommandInteraction<'cached'>,
  ownerId: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const board = getArtboard(db, interaction.guildId, ownerId);
  const items = listArtItems(db, interaction.guildId, { ownerId, sort: 'new' });
  const featured = items.find((i) => i.id === board?.featuredItemId) ?? null;
  const freshUrl = featured ? await freshUrlFor(interaction.client, featured) : null;
  const ownerName = await resolveDisplayName(interaction.guild, ownerId);
  await interaction.editReply({
    embeds: [renderBoardLandingEmbed(ownerId, ownerName, board, items, freshUrl)],
    content: items.length === 0
      ? '_No uploads yet — use `/art upload` to add the first piece._'
      : `_Use the dashboard → **Artboards** → **Browse** for paginated navigation. \`/art\` slash commands cover the basics here._`,
  });
}

async function handleJamGallery(
  interaction: ChatInputCommandInteraction<'cached'>,
): Promise<void> {
  const jamId = interaction.options.getInteger('jam', true);
  const jams = listJams(db, interaction.guildId, { includeArchived: true });
  const jam = jams.find((j) => j.id === jamId);
  if (!jam) {
    await interaction.reply({
      content: `❌ No jam with id \`${jamId}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const items = listArtItems(db, interaction.guildId, { jamId, sort: 'new' });
  const summary = {
    total: items.length,
    distinctOwners: new Set(items.map((i) => i.ownerId)).size,
    latest: items.slice(0, 5),
    featured: items.filter((i) => i.featured).slice(0, 5),
  };
  await interaction.reply({
    embeds: [renderJamGalleryEmbed(jam.title, summary)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleEdit(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const itemId = interaction.options.getInteger('id', true);
  const item = getArtItem(db, interaction.guildId, itemId);
  if (!item || item.deletedAt) {
    await interaction.reply({
      content: `❌ No art item with id \`${itemId}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!canEditItem(item, interaction.user.id, isAdmin(interaction))) {
    await interaction.reply({
      content: '❌ You can only edit your own uploads.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const title = interaction.options.getString('title') ?? undefined;
  const caption = interaction.options.getString('caption');
  const categoryStr = interaction.options.getString('category');
  const category =
    categoryStr == null ? undefined : isArtCategory(categoryStr) ? categoryStr : null;
  const tagsRaw = interaction.options.getString('tags');
  const jamIdOpt = interaction.options.getInteger('jam');

  const updated = updateArtItem(db, interaction.guildId, itemId, {
    title,
    caption: caption === null ? undefined : caption,
    category: category === null ? null : category,
    tags: tagsRaw == null ? undefined : parseTags(tagsRaw),
    jamId: jamIdOpt === null ? undefined : jamIdOpt === 0 ? null : jamIdOpt,
  });
  if (!updated) {
    await interaction.reply({
      content: '❌ Update failed.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const fresh = await freshUrlFor(interaction.client, updated);
  await interaction.reply({
    content: `✅ Updated **#${updated.id}**.`,
    embeds: [renderArtItemEmbed(updated, fresh)],
    flags: MessageFlags.Ephemeral,
  });
  await refreshDashboardMessage(interaction.client, interaction.guildId).catch(() => {});
}

async function handleDelete(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const itemId = interaction.options.getInteger('id', true);
  const item = getArtItem(db, interaction.guildId, itemId);
  if (!item || item.deletedAt) {
    await interaction.reply({
      content: `❌ No art item with id \`${itemId}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const admin = isAdmin(interaction);
  if (!canEditItem(item, interaction.user.id, admin)) {
    await interaction.reply({
      content: '❌ You can only delete your own uploads.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const removed = softDeleteArtItem(db, interaction.guildId, itemId);
  if (admin && item.ownerId !== interaction.user.id) {
    recordModAction(db, interaction.guildId, itemId, interaction.user.id, 'remove');
  }
  await interaction.reply({
    content: removed ? `🗑 Deleted **#${itemId}**.` : '❌ Delete failed.',
    flags: MessageFlags.Ephemeral,
  });
  await refreshDashboardMessage(interaction.client, interaction.guildId).catch(() => {});
}

async function handleBio(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const raw = interaction.options.getString('text');
  const text = raw == null ? null : raw.trim() || null;
  setArtboardBio(db, interaction.guildId, interaction.user.id, text);
  await interaction.reply({
    content: text ? `✅ Bio updated.` : '✅ Bio cleared.',
    flags: MessageFlags.Ephemeral,
  });
  await refreshDashboardMessage(interaction.client, interaction.guildId).catch(() => {});
}

async function handleFeature(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const itemId = interaction.options.getInteger('id', true);
  if (itemId === 0) {
    setArtboardFeatured(db, interaction.guildId, interaction.user.id, null);
    await interaction.reply({
      content: '✅ Cleared featured piece on your board.',
      flags: MessageFlags.Ephemeral,
    });
    await refreshDashboardMessage(interaction.client, interaction.guildId).catch(() => {});
    return;
  }
  const item = getArtItem(db, interaction.guildId, itemId);
  if (!item || item.deletedAt || item.ownerId !== interaction.user.id) {
    await interaction.reply({
      content: `❌ You can only feature your own uploads.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  setArtboardFeatured(db, interaction.guildId, interaction.user.id, itemId);
  updateArtItem(db, interaction.guildId, itemId, { featured: true });
  await interaction.reply({
    content: `⭐ Featured **#${itemId}** on your board.`,
    flags: MessageFlags.Ephemeral,
  });
  await refreshDashboardMessage(interaction.client, interaction.guildId).catch(() => {});
}
