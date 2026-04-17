import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Open (or create) the SQLite database at `databasePath`, apply pragmas,
 * bootstrap the schema, and return a Drizzle client typed against our schema.
 *
 * The bootstrap DDL is idempotent so this is safe on both fresh installs
 * and on existing databases carried over from earlier phases.
 *
 * Future schema evolution: add new CREATE TABLE IF NOT EXISTS + ALTER TABLE
 * statements here; we'll switch to drizzle-kit generated migrations once the
 * schema starts needing destructive changes.
 */
export function createDb(databasePath: string): Db {
  const dir = path.dirname(databasePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(BOOTSTRAP_SQL);

  return drizzle(sqlite, { schema });
}

const BOOTSTRAP_SQL = `
  -- Phase 1a: timezones
  CREATE TABLE IF NOT EXISTS user_timezones (
    guild_id   TEXT    NOT NULL,
    user_id    TEXT    NOT NULL,
    timezone   TEXT    NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS pinned_sheets (
    guild_id   TEXT    PRIMARY KEY,
    channel_id TEXT    NOT NULL,
    message_id TEXT    NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Phase 2: dashboard
  CREATE TABLE IF NOT EXISTS dashboards (
    guild_id        TEXT    PRIMARY KEY,
    channel_id      TEXT    NOT NULL,
    message_id      TEXT    NOT NULL,
    current_view    TEXT    NOT NULL DEFAULT 'home',
    focused_jam_id  INTEGER,
    updated_at      INTEGER NOT NULL
  );

  -- Phase 1b: jams
  CREATE TABLE IF NOT EXISTS jams (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id                 TEXT    NOT NULL,
    title                    TEXT    NOT NULL,
    description              TEXT,
    starts_at_utc            INTEGER NOT NULL,
    ends_at_utc              INTEGER NOT NULL,
    timezone                 TEXT    NOT NULL,
    submission_deadline_utc  INTEGER,
    voting_deadline_utc      INTEGER,
    announcement_channel_id  TEXT,
    participant_role_id      TEXT,
    created_by               TEXT    NOT NULL,
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL,
    archived_at              INTEGER
  );
  CREATE INDEX IF NOT EXISTS jams_guild_idx ON jams(guild_id);

  CREATE TABLE IF NOT EXISTS jam_reminders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    jam_id       INTEGER NOT NULL REFERENCES jams(id) ON DELETE CASCADE,
    kind         TEXT    NOT NULL,
    fire_at_utc  INTEGER NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    fired_at     INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS jam_reminders_kind_unique ON jam_reminders(jam_id, kind);
  CREATE INDEX IF NOT EXISTS jam_reminders_fire_idx ON jam_reminders(fire_at_utc, fired_at);

  -- Phase 1c: jobs
  CREATE TABLE IF NOT EXISTS jobs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT    NOT NULL,
    jam_id       INTEGER REFERENCES jams(id) ON DELETE SET NULL,
    title        TEXT    NOT NULL,
    description  TEXT,
    category     TEXT,
    priority     TEXT    NOT NULL DEFAULT 'normal',
    status       TEXT    NOT NULL DEFAULT 'unassigned',
    assignee_id  TEXT,
    due_at_utc   INTEGER,
    tags         TEXT    NOT NULL DEFAULT '[]',
    created_by   TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    archived_at  INTEGER
  );
  CREATE INDEX IF NOT EXISTS jobs_guild_idx ON jobs(guild_id);
  CREATE INDEX IF NOT EXISTS jobs_jam_idx ON jobs(jam_id);
  CREATE INDEX IF NOT EXISTS jobs_assignee_idx ON jobs(assignee_id);
  CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);

  CREATE TABLE IF NOT EXISTS job_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id    TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS job_comments_job_idx ON job_comments(job_id);
`;

export * from './schema';
export { schema };
