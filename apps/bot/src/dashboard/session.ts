import type { JobStatus } from '@tegutime/domain';

/**
 * Per-guild dashboard session state held in memory.
 *
 * Intentionally non-persistent: the dashboard is a shared view and "where
 * everyone left it" is better reset on bot restart than trying to reconcile
 * stale filter state across deploys. If we ever need persistence we can back
 * this with a `dashboard_state` table.
 */
export interface JobsFilterState {
  status: JobStatus | 'all';
  jamId: number | 'any';
  page: number;
}

const jobsFilters = new Map<string, JobsFilterState>();

export const DEFAULT_JOBS_FILTER: JobsFilterState = {
  status: 'all',
  jamId: 'any',
  page: 1,
};

export function getJobsFilter(guildId: string): JobsFilterState {
  return jobsFilters.get(guildId) ?? DEFAULT_JOBS_FILTER;
}

export function setJobsFilter(
  guildId: string,
  patch: Partial<JobsFilterState>,
): JobsFilterState {
  const next = { ...getJobsFilter(guildId), ...patch };
  jobsFilters.set(guildId, next);
  return next;
}

export function resetJobsFilter(guildId: string): void {
  jobsFilters.delete(guildId);
}
