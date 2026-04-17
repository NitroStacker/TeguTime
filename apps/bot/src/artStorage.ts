import type { Attachment, Client, Guild, TextBasedChannel } from 'discord.js';
import { getArtSettings } from '@tegutime/domain';
import { db } from './db';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MiB — Discord Free tier ceiling.

export const ALLOWED_CONTENT_TYPES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/apng',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

/**
 * A durable handle to a file living in the bot's storage channel. Field names
 * mirror the `art_items` columns so we can pass the row directly.
 */
export interface StorageRef {
  storageChannelId: string;
  storageMessageId: string;
  storageAttachmentId: string;
}

export interface RehostedAttachment extends StorageRef {
  url: string; // freshly signed at rehost time
  filename: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
}

export class ArtStorageNotConfigured extends Error {
  constructor() {
    super(
      'Artboard storage channel is not configured. An admin needs to run `/art setup channel:<channel>` first.',
    );
  }
}

async function getStorageChannel(guild: Guild): Promise<TextBasedChannel> {
  const settings = getArtSettings(db, guild.id);
  if (!settings.storageChannelId) throw new ArtStorageNotConfigured();
  const channel = await guild.channels.fetch(settings.storageChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new ArtStorageNotConfigured();
  return channel;
}

/**
 * Re-host a user-supplied attachment in the bot's storage channel. Discord
 * re-serves the bytes from its own CDN, giving us a durable reference we can
 * re-sign later. Returns the storage coordinates + the freshly-signed URL.
 */
export async function rehostAttachment(
  guild: Guild,
  source: Attachment,
): Promise<RehostedAttachment> {
  if (source.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is too large (${Math.round(source.size / 1024)} KB > 25 MB).`);
  }
  const contentType = (source.contentType ?? '').toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error(
      `Unsupported file type \`${contentType || 'unknown'}\`. Allowed: PNG, JPEG, WebP, GIF, APNG, MP4, WebM, MOV.`,
    );
  }

  const channel = await getStorageChannel(guild);
  if (!('send' in channel) || typeof channel.send !== 'function') {
    throw new Error('Storage channel is not writable.');
  }

  const sent = await channel.send({
    files: [{ attachment: source.url, name: source.name }],
    content: `🎨 archived for guild ${guild.id}`,
  });

  const attachment = sent.attachments.first();
  if (!attachment) throw new Error('Discord did not attach the file to the storage message.');

  return {
    storageChannelId: channel.id,
    storageMessageId: sent.id,
    storageAttachmentId: attachment.id,
    url: attachment.url,
    filename: attachment.name ?? source.name,
    contentType: attachment.contentType ?? contentType,
    size: attachment.size,
    width: attachment.width ?? source.width ?? null,
    height: attachment.height ?? source.height ?? null,
  };
}

/**
 * Re-fetch the storage message and hand back a freshly-signed attachment URL.
 * Returns null if the storage message or attachment is gone.
 */
export async function freshUrlFor(
  client: Client,
  ref: StorageRef,
): Promise<string | null> {
  const channel = await client.channels.fetch(ref.storageChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  const message = await channel.messages.fetch(ref.storageMessageId).catch(() => null);
  if (!message) return null;
  const attachment =
    message.attachments.get(ref.storageAttachmentId) ?? message.attachments.first();
  return attachment?.url ?? null;
}

/**
 * Batch-resolve URLs for several items in parallel.
 */
export async function freshUrlForMany(
  client: Client,
  refs: StorageRef[],
): Promise<Map<string, string | null>> {
  const entries = await Promise.all(
    refs.map(
      async (ref) =>
        [ref.storageAttachmentId, await freshUrlFor(client, ref)] as const,
    ),
  );
  return new Map(entries);
}
