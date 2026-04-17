import { MessageFlags, type Client, type Guild, type TextBasedChannel } from 'discord.js';
import {
  type DashboardViewId,
  getDashboard,
  setDashboardView,
  upsertDashboard,
  clearDashboard,
} from '@tegutime/domain';
import { db } from '../db';
import { renderHome } from './views/home';
import { renderJamView } from './views/jam';
import { renderTimezonesView } from './views/timezones';
import { renderJobsView } from './views/jobs';
import { renderAdminView } from './views/admin';
import type { DashboardContext, DashboardView } from './types';

/**
 * Entry point for every dashboard render. Pure: given a context, returns
 * `{ embeds, components }`. Any side effects (editing the persistent message,
 * replying ephemerally) live in the caller.
 */
export function renderView(ctx: DashboardContext, view: DashboardViewId): DashboardView {
  switch (view) {
    case 'home':
      return renderHome(ctx);
    case 'jam':
      return renderJamView(ctx);
    case 'timezones':
      return renderTimezonesView(ctx);
    case 'jobs':
      return renderJobsView(ctx);
    case 'admin':
      return renderAdminView(ctx);
  }
}

export function buildContext(
  guild: Guild,
  forUserId: string,
  isAdmin: boolean,
  focusedJamId: number | null = null,
): DashboardContext {
  return { db, guild, forUserId, isAdmin, focusedJamId };
}

/**
 * Post a fresh dashboard message into `channel`, replacing any prior one.
 * Called by `/dashboard` (admin) and by the "Repost" admin action.
 */
export async function postDashboard(
  client: Client,
  guild: Guild,
  channel: TextBasedChannel,
  forUserId: string,
  isAdmin: boolean,
): Promise<string> {
  const existing = getDashboard(db, guild.id);
  if (existing) {
    const oldChannel = await guild.channels.fetch(existing.channelId).catch(() => null);
    if (oldChannel && 'messages' in oldChannel) {
      const oldMsg = await oldChannel.messages.fetch(existing.messageId).catch(() => null);
      if (oldMsg) await oldMsg.delete().catch(() => {});
    }
    clearDashboard(db, guild.id);
  }

  const ctx = buildContext(guild, forUserId, isAdmin, null);
  const view = renderView(ctx, 'home');

  if (!('send' in channel)) {
    throw new Error('Chosen channel does not support messages.');
  }
  const message = await channel.send({
    embeds: view.embeds,
    components: view.components,
  });

  upsertDashboard(db, guild.id, channel.id, message.id, 'home', null);
  return message.url;
}

/**
 * Re-render the persistent dashboard message from the latest DB + session
 * state. Used after out-of-band mutations (e.g. a slash command created a
 * jam and we want the dashboard to stay fresh).
 */
export async function refreshDashboardMessage(
  client: Client,
  guildId: string,
): Promise<void> {
  const state = getDashboard(db, guildId);
  if (!state) return;
  const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) return;

  const channel = await guild.channels.fetch(state.channelId).catch(() => null);
  if (!channel || !('messages' in channel)) {
    clearDashboard(db, guildId);
    return;
  }
  const message = await channel.messages.fetch(state.messageId).catch(() => null);
  if (!message) {
    clearDashboard(db, guildId);
    return;
  }

  const ctx = buildContext(guild, client.user?.id ?? '', true, state.focusedJamId);
  const view = renderView(ctx, state.currentView);
  await message.edit({ embeds: view.embeds, components: view.components }).catch((err) => {
    console.error(`[dashboard] refresh edit failed for ${guildId}:`, err);
  });
}

/**
 * Persist the current view so background refreshes stay on the right tab.
 */
export function persistView(
  guildId: string,
  view: DashboardViewId,
  focusedJamId?: number | null,
): void {
  setDashboardView(db, guildId, view, focusedJamId);
}
