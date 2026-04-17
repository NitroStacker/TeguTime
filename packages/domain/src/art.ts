import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  type Db,
  artSettings,
  artboards,
  artItems,
  artModActions,
  type ArtItemRow,
  type ArtboardRow,
} from '@tegutime/db';

// ---- Enums ----

export const ART_CATEGORIES = [
  'concept_art',
  'ui',
  'animation',
  'environment',
  'character',
  'logo',
  'screenshot',
  'reference',
  'other',
] as const;
export type ArtCategory = (typeof ART_CATEGORIES)[number];

export const MEDIA_TYPES = ['image', 'gif', 'video'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const ART_SORT_OPTIONS = ['new', 'old'] as const;
export type ArtSort = (typeof ART_SORT_OPTIONS)[number];

export function isArtCategory(v: unknown): v is ArtCategory {
  return typeof v === 'string' && (ART_CATEGORIES as readonly string[]).includes(v);
}
export function isMediaType(v: unknown): v is MediaType {
  return typeof v === 'string' && (MEDIA_TYPES as readonly string[]).includes(v);
}

/**
 * Infer media type from a MIME string. Falls back to 'image' for unknown
 * image/* types and lets the caller reject anything outside the allow list.
 */
export function classifyMedia(contentType: string): MediaType | null {
  const ct = contentType.toLowerCase();
  if (ct === 'image/gif') return 'gif';
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  return null;
}

// ---- View model with parsed tags ----

export interface ArtItem extends Omit<ArtItemRow, 'tags' | 'featured'> {
  tags: string[];
  featured: boolean;
}

function parseItem(row: ArtItemRow): ArtItem {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags);
    if (Array.isArray(parsed)) tags = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    // leave empty
  }
  return {
    ...row,
    tags,
    featured: Boolean(row.featured),
  };
}

// ---- Inputs ----

export interface CreateArtItemInput {
  guildId: string;
  ownerId: string;
  jamId?: number | null;
  storageChannelId: string;
  storageMessageId: string;
  storageAttachmentId: string;
  filename: string;
  mediaType: MediaType;
  contentType: string;
  fileSizeBytes: number;
  width?: number | null;
  height?: number | null;
  title: string;
  caption?: string | null;
  category?: ArtCategory | null;
  tags?: string[];
}

export interface UpdateArtItemInput {
  title?: string;
  caption?: string | null;
  category?: ArtCategory | null;
  tags?: string[];
  jamId?: number | null;
  featured?: boolean;
}

export interface ListArtItemsFilters {
  ownerId?: string;
  jamId?: number | null | 'any';
  category?: ArtCategory;
  mediaType?: MediaType;
  featured?: boolean;
  sort?: ArtSort;
  includeDeleted?: boolean;
}

// ---- Settings ----

export function getArtSettings(db: Db, guildId: string): { storageChannelId: string | null } {
  const row = db.select().from(artSettings).where(eq(artSettings.guildId, guildId)).get();
  return { storageChannelId: row?.storageChannelId ?? null };
}

export function setArtStorageChannel(db: Db, guildId: string, channelId: string): void {
  db.insert(artSettings)
    .values({ guildId, storageChannelId: channelId, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: artSettings.guildId,
      set: { storageChannelId: channelId, updatedAt: Date.now() },
    })
    .run();
}

// ---- Artboards (owner metadata) ----

export function ensureArtboard(db: Db, guildId: string, userId: string): ArtboardRow {
  const existing = db
    .select()
    .from(artboards)
    .where(and(eq(artboards.guildId, guildId), eq(artboards.userId, userId)))
    .get();
  if (existing) return existing;
  const now = Date.now();
  const inserted = db
    .insert(artboards)
    .values({ guildId, userId, bio: null, featuredItemId: null, createdAt: now, updatedAt: now })
    .returning()
    .get();
  return inserted;
}

export function getArtboard(db: Db, guildId: string, userId: string): ArtboardRow | null {
  const row = db
    .select()
    .from(artboards)
    .where(and(eq(artboards.guildId, guildId), eq(artboards.userId, userId)))
    .get();
  return row ?? null;
}

export function setArtboardBio(
  db: Db,
  guildId: string,
  userId: string,
  bio: string | null,
): ArtboardRow {
  ensureArtboard(db, guildId, userId);
  const row = db
    .update(artboards)
    .set({ bio, updatedAt: Date.now() })
    .where(and(eq(artboards.guildId, guildId), eq(artboards.userId, userId)))
    .returning()
    .get();
  return row;
}

export function setArtboardFeatured(
  db: Db,
  guildId: string,
  userId: string,
  itemId: number | null,
): ArtboardRow {
  ensureArtboard(db, guildId, userId);
  const row = db
    .update(artboards)
    .set({ featuredItemId: itemId, updatedAt: Date.now() })
    .where(and(eq(artboards.guildId, guildId), eq(artboards.userId, userId)))
    .returning()
    .get();
  return row;
}

// ---- Items ----

export function createArtItem(db: Db, input: CreateArtItemInput): ArtItem {
  ensureArtboard(db, input.guildId, input.ownerId);
  const now = Date.now();
  const row = db
    .insert(artItems)
    .values({
      guildId: input.guildId,
      ownerId: input.ownerId,
      jamId: input.jamId ?? null,
      storageChannelId: input.storageChannelId,
      storageMessageId: input.storageMessageId,
      storageAttachmentId: input.storageAttachmentId,
      filename: input.filename,
      mediaType: input.mediaType,
      contentType: input.contentType,
      fileSizeBytes: input.fileSizeBytes,
      width: input.width ?? null,
      height: input.height ?? null,
      title: input.title,
      caption: input.caption ?? null,
      category: input.category ?? null,
      tags: JSON.stringify(input.tags ?? []),
      featured: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    .returning()
    .get();
  return parseItem(row);
}

export function getArtItem(db: Db, guildId: string, itemId: number): ArtItem | null {
  const row = db
    .select()
    .from(artItems)
    .where(and(eq(artItems.id, itemId), eq(artItems.guildId, guildId)))
    .get();
  return row ? parseItem(row) : null;
}

export function updateArtItem(
  db: Db,
  guildId: string,
  itemId: number,
  patch: UpdateArtItemInput,
): ArtItem | null {
  const set: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.caption !== undefined) set.caption = patch.caption;
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.tags !== undefined) set.tags = JSON.stringify(patch.tags);
  if (patch.jamId !== undefined) set.jamId = patch.jamId;
  if (patch.featured !== undefined) set.featured = patch.featured;

  const row = db
    .update(artItems)
    .set(set)
    .where(and(eq(artItems.id, itemId), eq(artItems.guildId, guildId)))
    .returning()
    .get();
  return row ? parseItem(row) : null;
}

export function softDeleteArtItem(db: Db, guildId: string, itemId: number): boolean {
  const result = db
    .update(artItems)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(artItems.id, itemId), eq(artItems.guildId, guildId), isNull(artItems.deletedAt)))
    .run();
  return result.changes > 0;
}

export function listArtItems(
  db: Db,
  guildId: string,
  filters: ListArtItemsFilters = {},
): ArtItem[] {
  const where = [eq(artItems.guildId, guildId)];
  if (!filters.includeDeleted) where.push(isNull(artItems.deletedAt));
  if (filters.ownerId) where.push(eq(artItems.ownerId, filters.ownerId));
  if (filters.jamId === null) where.push(isNull(artItems.jamId));
  else if (typeof filters.jamId === 'number') where.push(eq(artItems.jamId, filters.jamId));
  if (filters.category) where.push(eq(artItems.category, filters.category));
  if (filters.mediaType) where.push(eq(artItems.mediaType, filters.mediaType));
  if (filters.featured !== undefined) {
    where.push(eq(artItems.featured, filters.featured));
  }

  const rows = db
    .select()
    .from(artItems)
    .where(and(...where))
    .orderBy(filters.sort === 'old' ? asc(artItems.createdAt) : desc(artItems.createdAt))
    .all();
  return rows.map(parseItem);
}

// ---- Summaries ----

export interface BoardOwnerSummary {
  userId: string;
  itemCount: number;
  latestAt: number;
  featuredItemId: number | null;
}

export function listBoardOwners(db: Db, guildId: string): BoardOwnerSummary[] {
  const rows = db
    .select({
      userId: artItems.ownerId,
      itemCount: sql<number>`COUNT(*)`.as('item_count'),
      latestAt: sql<number>`MAX(${artItems.createdAt})`.as('latest_at'),
    })
    .from(artItems)
    .where(and(eq(artItems.guildId, guildId), isNull(artItems.deletedAt)))
    .groupBy(artItems.ownerId)
    .orderBy(desc(sql`latest_at`))
    .all();

  // Attach featured item id (if owner set one)
  if (rows.length === 0) return [];
  const boardRows = db
    .select()
    .from(artboards)
    .where(
      and(
        eq(artboards.guildId, guildId),
        inArray(
          artboards.userId,
          rows.map((r) => r.userId),
        ),
      ),
    )
    .all();
  const featuredByUser = new Map(boardRows.map((b) => [b.userId, b.featuredItemId ?? null]));
  return rows.map((r) => ({
    userId: r.userId,
    itemCount: Number(r.itemCount),
    latestAt: Number(r.latestAt),
    featuredItemId: featuredByUser.get(r.userId) ?? null,
  }));
}

export interface JamGallerySummary {
  total: number;
  distinctOwners: number;
  latest: ArtItem[];
  featured: ArtItem[];
}

export function summarizeJamGallery(
  db: Db,
  guildId: string,
  jamId: number | null,
): JamGallerySummary {
  const items = listArtItems(db, guildId, {
    jamId: jamId ?? undefined,
    sort: 'new',
  }).filter((i) => (jamId == null ? true : i.jamId === jamId));
  const owners = new Set(items.map((i) => i.ownerId));
  return {
    total: items.length,
    distinctOwners: owners.size,
    latest: items.slice(0, 5),
    featured: items.filter((i) => i.featured).slice(0, 5),
  };
}

// ---- Moderation ----

export function recordModAction(
  db: Db,
  guildId: string,
  itemId: number,
  modUserId: string,
  action: 'remove' | 'feature' | 'unfeature',
  reason: string | null = null,
): void {
  db.insert(artModActions)
    .values({ guildId, itemId, modUserId, action, reason, createdAt: Date.now() })
    .run();
}
