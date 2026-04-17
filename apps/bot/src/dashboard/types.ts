import type {
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  Guild,
  StringSelectMenuBuilder,
} from 'discord.js';
import type { DashboardViewId } from '@tegutime/domain';
import type { Db } from '@tegutime/db';

/**
 * Any row the dashboard supports. Discord allows up to 5 component rows per
 * message, each of which is either 1-5 buttons OR exactly 1 select menu.
 */
export type DashboardRow = ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>;

export interface DashboardContext {
  db: Db;
  guild: Guild;
  /** User ID of whoever just triggered the render — used for "My jobs" etc. */
  forUserId: string;
  /** ManageGuild cached once so we don't recompute per-view. */
  isAdmin: boolean;
  /** The jam the user is currently "focused on" in the Jam view. */
  focusedJamId: number | null;
}

export interface DashboardView {
  embeds: EmbedBuilder[];
  components: DashboardRow[];
}

export type DashboardRenderer = (
  ctx: DashboardContext,
) => Promise<DashboardView> | DashboardView;
