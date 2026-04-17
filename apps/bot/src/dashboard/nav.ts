import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { DashboardViewId } from '@tegutime/domain';
import { navId } from './ids';
import type { DashboardRow } from './types';

interface TabSpec {
  id: DashboardViewId;
  label: string;
  emoji: string;
  adminOnly?: boolean;
}

const TABS: TabSpec[] = [
  { id: 'home', label: 'Home', emoji: '🎛' },
  { id: 'jam', label: 'Jam', emoji: '🎮' },
  { id: 'timezones', label: 'Timezones', emoji: '🌍' },
  { id: 'jobs', label: 'Jobs', emoji: '📋' },
  { id: 'admin', label: 'Admin', emoji: '⚙️', adminOnly: true },
];

/**
 * Build the navigation row. The current view is styled as Primary; the rest
 * are Secondary. Admin tab is disabled for non-admins so it stays visually
 * present (consistent layout) without being actionable.
 */
export function buildNavigationRow(
  currentView: DashboardViewId,
  isAdmin: boolean,
): DashboardRow {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const tab of TABS) {
    const btn = new ButtonBuilder()
      .setCustomId(navId(tab.id))
      .setLabel(tab.label)
      .setEmoji(tab.emoji)
      .setStyle(tab.id === currentView ? ButtonStyle.Primary : ButtonStyle.Secondary);
    if (tab.adminOnly && !isAdmin) btn.setDisabled(true);
    row.addComponents(btn);
  }
  return row;
}
