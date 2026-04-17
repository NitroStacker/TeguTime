import { eq } from 'drizzle-orm';
import { type Db, dashboards, type DashboardRow } from '@tegutime/db';

export type DashboardViewId = 'home' | 'jam' | 'timezones' | 'jobs' | 'admin';

export const DASHBOARD_VIEWS: DashboardViewId[] = [
  'home',
  'jam',
  'timezones',
  'jobs',
  'admin',
];

export interface DashboardState {
  guildId: string;
  channelId: string;
  messageId: string;
  currentView: DashboardViewId;
  focusedJamId: number | null;
  updatedAt: number;
}

function toState(row: DashboardRow): DashboardState {
  const view = DASHBOARD_VIEWS.includes(row.currentView as DashboardViewId)
    ? (row.currentView as DashboardViewId)
    : 'home';
  return {
    guildId: row.guildId,
    channelId: row.channelId,
    messageId: row.messageId,
    currentView: view,
    focusedJamId: row.focusedJamId ?? null,
    updatedAt: row.updatedAt,
  };
}

export function getDashboard(db: Db, guildId: string): DashboardState | null {
  const row = db.select().from(dashboards).where(eq(dashboards.guildId, guildId)).get();
  return row ? toState(row) : null;
}

export function upsertDashboard(
  db: Db,
  guildId: string,
  channelId: string,
  messageId: string,
  currentView: DashboardViewId = 'home',
  focusedJamId: number | null = null,
): void {
  db.insert(dashboards)
    .values({
      guildId,
      channelId,
      messageId,
      currentView,
      focusedJamId,
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: dashboards.guildId,
      set: {
        channelId,
        messageId,
        currentView,
        focusedJamId,
        updatedAt: Date.now(),
      },
    })
    .run();
}

export function setDashboardView(
  db: Db,
  guildId: string,
  currentView: DashboardViewId,
  focusedJamId?: number | null,
): void {
  const patch: Record<string, unknown> = {
    currentView,
    updatedAt: Date.now(),
  };
  if (focusedJamId !== undefined) patch.focusedJamId = focusedJamId;
  db.update(dashboards).set(patch).where(eq(dashboards.guildId, guildId)).run();
}

export function clearDashboard(db: Db, guildId: string): void {
  db.delete(dashboards).where(eq(dashboards.guildId, guildId)).run();
}
