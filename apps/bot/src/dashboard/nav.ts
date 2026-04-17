import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { DashboardViewId } from '@tegutime/domain';
import { navId } from './ids';
import type { DashboardRow } from './types';

interface TabSpec {
  id: DashboardViewId;
  label: string;
  emoji: string;
}

/**
 * Five primary tabs. Admin is intentionally NOT here — it's reached via a
 * dedicated button on Home (admin-only). That keeps the nav row at exactly
 * 5 buttons while leaving admin actions one click away for those who need
 * them.
 */
const TABS: TabSpec[] = [
  { id: 'home', label: 'Home', emoji: '🎛' },
  { id: 'jam', label: 'Jam', emoji: '🎮' },
  { id: 'timezones', label: 'Timezones', emoji: '🌍' },
  { id: 'jobs', label: 'Jobs', emoji: '📋' },
  { id: 'artboards', label: 'Artboards', emoji: '🖼' },
];

export function buildNavigationRow(
  currentView: DashboardViewId,
  _isAdmin: boolean,
): DashboardRow {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const tab of TABS) {
    const btn = new ButtonBuilder()
      .setCustomId(navId(tab.id))
      .setLabel(tab.label)
      .setEmoji(tab.emoji)
      .setStyle(tab.id === currentView ? ButtonStyle.Primary : ButtonStyle.Secondary);
    row.addComponents(btn);
  }
  return row;
}
