import { and, asc, desc, eq } from 'drizzle-orm';
import {
  type Db,
  jobs,
  jobComments,
  type JobRow,
  type JobCommentRow,
} from '@tegutime/db';

// ---- Enums ----

export const JOB_STATUSES = [
  'unassigned',
  'assigned',
  'in_progress',
  'blocked',
  'complete',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];

export function isJobStatus(v: unknown): v is JobStatus {
  return typeof v === 'string' && (JOB_STATUSES as readonly string[]).includes(v);
}
export function isJobPriority(v: unknown): v is JobPriority {
  return typeof v === 'string' && (JOB_PRIORITIES as readonly string[]).includes(v);
}

// ---- Inputs ----

export interface CreateJobInput {
  guildId: string;
  jamId?: number | null;
  title: string;
  description?: string | null;
  category?: string | null;
  priority?: JobPriority;
  assigneeId?: string | null;
  dueAtUtc?: number | null;
  tags?: string[];
  createdBy: string;
}

export interface EditJobInput {
  title?: string;
  description?: string | null;
  category?: string | null;
  priority?: JobPriority;
  dueAtUtc?: number | null;
  tags?: string[];
  jamId?: number | null;
}

export interface ListJobsFilters {
  jamId?: number | null | 'any';
  status?: JobStatus | JobStatus[];
  assigneeId?: string | null;
  category?: string;
  includeArchived?: boolean;
}

// ---- View types with parsed tags ----

export interface Job extends Omit<JobRow, 'tags'> {
  tags: string[];
}

function parseRow(row: JobRow): Job {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags);
    if (Array.isArray(parsed)) tags = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    // leave empty
  }
  return { ...row, tags };
}

// ---- CRUD ----

export function createJob(db: Db, input: CreateJobInput): Job {
  const now = Date.now();
  const priority = input.priority ?? 'normal';
  const status: JobStatus = input.assigneeId ? 'assigned' : 'unassigned';
  const tags = input.tags ?? [];

  const row = db
    .insert(jobs)
    .values({
      guildId: input.guildId,
      jamId: input.jamId ?? null,
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? null,
      priority,
      status,
      assigneeId: input.assigneeId ?? null,
      dueAtUtc: input.dueAtUtc ?? null,
      tags: JSON.stringify(tags),
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    })
    .returning()
    .get();

  return parseRow(row);
}

export function getJob(db: Db, guildId: string, jobId: number): Job | null {
  const row = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.guildId, guildId)))
    .get();
  return row ? parseRow(row) : null;
}

export function editJob(
  db: Db,
  guildId: string,
  jobId: number,
  patch: EditJobInput,
): Job | null {
  const row = db
    .update(jobs)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.dueAtUtc !== undefined ? { dueAtUtc: patch.dueAtUtc } : {}),
      ...(patch.tags !== undefined ? { tags: JSON.stringify(patch.tags) } : {}),
      ...(patch.jamId !== undefined ? { jamId: patch.jamId } : {}),
      updatedAt: Date.now(),
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.guildId, guildId)))
    .returning()
    .get();
  return row ? parseRow(row) : null;
}

export function deleteJob(db: Db, guildId: string, jobId: number): boolean {
  return (
    db
      .delete(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.guildId, guildId)))
      .run().changes > 0
  );
}

export function archiveJob(db: Db, guildId: string, jobId: number): Job | null {
  const now = Date.now();
  const row = db
    .update(jobs)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(jobs.id, jobId), eq(jobs.guildId, guildId)))
    .returning()
    .get();
  return row ? parseRow(row) : null;
}

export function unarchiveJob(db: Db, guildId: string, jobId: number): Job | null {
  const row = db
    .update(jobs)
    .set({ archivedAt: null, updatedAt: Date.now() })
    .where(and(eq(jobs.id, jobId), eq(jobs.guildId, guildId)))
    .returning()
    .get();
  return row ? parseRow(row) : null;
}

// ---- Assignment + status transitions ----

export function assignJob(
  db: Db,
  guildId: string,
  jobId: number,
  assigneeId: string,
): Job | null {
  const now = Date.now();
  const row = db
    .update(jobs)
    .set({ assigneeId, status: 'assigned', updatedAt: now })
    .where(and(eq(jobs.id, jobId), eq(jobs.guildId, guildId)))
    .returning()
    .get();
  return row ? parseRow(row) : null;
}

export function unassignJob(db: Db, guildId: string, jobId: number): Job | null {
  const now = Date.now();
  const row = db
    .update(jobs)
    .set({ assigneeId: null, status: 'unassigned', updatedAt: now })
    .where(and(eq(jobs.id, jobId), eq(jobs.guildId, guildId)))
    .returning()
    .get();
  return row ? parseRow(row) : null;
}

export function setJobStatus(
  db: Db,
  guildId: string,
  jobId: number,
  status: JobStatus,
): Job | null {
  const row = db
    .update(jobs)
    .set({ status, updatedAt: Date.now() })
    .where(and(eq(jobs.id, jobId), eq(jobs.guildId, guildId)))
    .returning()
    .get();
  return row ? parseRow(row) : null;
}

// ---- Listing ----

export function listJobs(db: Db, guildId: string, filters: ListJobsFilters = {}): Job[] {
  const rows = db
    .select()
    .from(jobs)
    .where(eq(jobs.guildId, guildId))
    .orderBy(desc(jobs.updatedAt))
    .all();

  const statuses = filters.status
    ? Array.isArray(filters.status)
      ? filters.status
      : [filters.status]
    : null;

  return rows
    .filter((r) => {
      if (!filters.includeArchived && r.archivedAt != null) return false;
      if (filters.jamId === 'any') {
        // no filter
      } else if (filters.jamId === null) {
        if (r.jamId != null) return false;
      } else if (filters.jamId !== undefined) {
        if (r.jamId !== filters.jamId) return false;
      }
      if (statuses && !statuses.includes(r.status as JobStatus)) return false;
      if (filters.assigneeId !== undefined) {
        if (filters.assigneeId === null) {
          if (r.assigneeId != null) return false;
        } else if (r.assigneeId !== filters.assigneeId) return false;
      }
      if (filters.category && r.category !== filters.category) return false;
      return true;
    })
    .map(parseRow);
}

export interface JobSummary {
  total: number;
  byStatus: Record<JobStatus, number>;
  overdue: number;
  completionPct: number; // 0-100
}

export function summarizeJobs(list: Job[], now: number = Date.now()): JobSummary {
  const byStatus: Record<JobStatus, number> = {
    unassigned: 0,
    assigned: 0,
    in_progress: 0,
    blocked: 0,
    complete: 0,
    cancelled: 0,
  };
  let overdue = 0;
  for (const job of list) {
    byStatus[job.status as JobStatus] = (byStatus[job.status as JobStatus] ?? 0) + 1;
    if (
      job.dueAtUtc != null &&
      job.dueAtUtc < now &&
      job.status !== 'complete' &&
      job.status !== 'cancelled'
    ) {
      overdue += 1;
    }
  }
  const completable = list.length - byStatus.cancelled;
  const completionPct =
    completable === 0 ? 0 : Math.round((byStatus.complete / completable) * 100);
  return { total: list.length, byStatus, overdue, completionPct };
}

// ---- Comments ----

export function addJobComment(
  db: Db,
  jobId: number,
  userId: string,
  content: string,
): JobCommentRow {
  return db
    .insert(jobComments)
    .values({ jobId, userId, content, createdAt: Date.now() })
    .returning()
    .get();
}

export function listJobComments(db: Db, jobId: number): JobCommentRow[] {
  return db
    .select()
    .from(jobComments)
    .where(eq(jobComments.jobId, jobId))
    .orderBy(asc(jobComments.createdAt))
    .all();
}

// ---- Permission helpers (pure — caller feeds them Discord state) ----

export function canTransitionJobStatus(
  job: Job,
  userId: string,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  return job.assigneeId === userId || job.createdBy === userId;
}

export function canEditJob(job: Job, userId: string, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return job.createdBy === userId;
}
