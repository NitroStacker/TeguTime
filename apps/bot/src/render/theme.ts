import type { JamStatus } from '@tegutime/domain';
import type { JobStatus, JobPriority } from '@tegutime/domain';

/**
 * Discord-native accent colors. Kept in one place so the bot's visual system
 * stays cohesive across embeds.
 */
export const COLOR = {
  PRIMARY: 0x5865f2,
  UPCOMING: 0xfaa61a,
  LIVE: 0x57f287,
  ENDED: 0xed4245,
  ARCHIVED: 0x747f8d,
  WARNING: 0xfee75c,
  SUCCESS: 0x57f287,
  ERROR: 0xed4245,
  MUTED: 0x2b2d31,
} as const;

export const JAM_STATUS_BADGE: Record<JamStatus, string> = {
  upcoming: '🟡 Upcoming',
  live: '🟢 Live',
  ended: '🔴 Ended',
  archived: '🗂 Archived',
};

export const JAM_STATUS_COLOR: Record<JamStatus, number> = {
  upcoming: COLOR.UPCOMING,
  live: COLOR.LIVE,
  ended: COLOR.ENDED,
  archived: COLOR.ARCHIVED,
};

export const JOB_STATUS_BADGE: Record<JobStatus, string> = {
  unassigned: '⚪ Unassigned',
  assigned: '🔵 Assigned',
  in_progress: '🟡 In Progress',
  blocked: '🟠 Blocked',
  complete: '🟢 Complete',
  cancelled: '⚫ Cancelled',
};

export const JOB_STATUS_ORDER: JobStatus[] = [
  'in_progress',
  'blocked',
  'assigned',
  'unassigned',
  'complete',
  'cancelled',
];

export const PRIORITY_BADGE: Record<JobPriority, string> = {
  low: '⬇ Low',
  normal: '• Normal',
  high: '⬆ High',
  urgent: '🚨 Urgent',
};

export const PRIORITY_ORDER: Record<JobPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};
