import type { DashboardViewId } from '@tegutime/domain';

/**
 * All dashboard custom_ids live here. Discord caps custom_id at 100 chars so
 * we keep the grammar compact: `dash:<view>:<action>[:<arg>...]`.
 *
 * Any id that isn't prefixed `dash:` is ignored by the router, letting us
 * share the single InteractionCreate listener with other features.
 */
export const DASH_PREFIX = 'dash';

// --- navigation ---
export const navId = (view: DashboardViewId) => `${DASH_PREFIX}:nav:${view}`;
export const refreshId = () => `${DASH_PREFIX}:refresh`;

// --- home quick actions ---
export const homeQuickId = (action: 'board' | 'mine' | 'mytz') =>
  `${DASH_PREFIX}:home:${action}`;

// --- jam ---
export const jamFocusSelectId = () => `${DASH_PREFIX}:jam:focus`;
export const jamCreateBtnId = () => `${DASH_PREFIX}:jam:create`;
export const jamEditBtnId = (jamId: number) => `${DASH_PREFIX}:jam:edit:${jamId}`;
export const jamArchiveBtnId = (jamId: number) => `${DASH_PREFIX}:jam:archive:${jamId}`;
export const jamDetailsBtnId = (jamId: number) =>
  `${DASH_PREFIX}:jam:details:${jamId}`;

export const jamCreateModalId = () => `${DASH_PREFIX}:jam:create:submit`;
export const jamEditModalId = (jamId: number) =>
  `${DASH_PREFIX}:jam:edit:${jamId}:submit`;

// --- timezones ---
export const tzSetBtnId = () => `${DASH_PREFIX}:tz:set`;
export const tzRemoveBtnId = () => `${DASH_PREFIX}:tz:remove`;
export const tzSheetBtnId = () => `${DASH_PREFIX}:tz:sheet`;
export const tzSetPopularSelectId = () => `${DASH_PREFIX}:tz:set:popular`;
export const tzSearchBtnId = () => `${DASH_PREFIX}:tz:search`;
export const tzSearchModalId = () => `${DASH_PREFIX}:tz:search:submit`;

// --- jobs ---
export const jobsStatusSelectId = () => `${DASH_PREFIX}:jobs:filter:status`;
export const jobsJamSelectId = () => `${DASH_PREFIX}:jobs:filter:jam`;
export const jobsPickSelectId = () => `${DASH_PREFIX}:jobs:pick`;
export const jobsPagePrevId = (page: number) =>
  `${DASH_PREFIX}:jobs:page:${Math.max(1, page - 1)}`;
export const jobsPageNextId = (page: number) => `${DASH_PREFIX}:jobs:page:${page + 1}`;
export const jobsCreateBtnId = () => `${DASH_PREFIX}:jobs:create`;
export const jobsMineBtnId = () => `${DASH_PREFIX}:jobs:mine`;
export const jobsCreateModalId = () => `${DASH_PREFIX}:jobs:create:submit`;

// Per-job action ids (used in the ephemeral "pick a job" follow-up).
export const jobActionId = (
  action: 'view' | 'claim' | 'unclaim' | 'start' | 'block' | 'complete' | 'uncomplete',
  jobId: number,
) => `${DASH_PREFIX}:job:${action}:${jobId}`;

// --- admin ---
export const adminPinSheetId = () => `${DASH_PREFIX}:admin:pinsheet`;
export const adminRepostId = () => `${DASH_PREFIX}:admin:repost`;
