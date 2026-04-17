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
 * and on existing databases carried over from the pre-monorepo bot.
 *
 * Future migrations will land under `packages/db/migrations/` and be applied
 * by a dedicated runner; for Phase 1a we keep it simple.
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
`;

export * from './schema';
export { schema };
