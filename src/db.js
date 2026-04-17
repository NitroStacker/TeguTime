import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const dir = path.dirname(config.databasePath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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
`);

const stmts = {
  upsertTimezone: db.prepare(`
    INSERT INTO user_timezones (guild_id, user_id, timezone, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      timezone   = excluded.timezone,
      updated_at = excluded.updated_at
  `),
  getTimezone: db.prepare(
    `SELECT timezone FROM user_timezones WHERE guild_id = ? AND user_id = ?`
  ),
  removeTimezone: db.prepare(
    `DELETE FROM user_timezones WHERE guild_id = ? AND user_id = ?`
  ),
  listTimezones: db.prepare(
    `SELECT user_id, timezone FROM user_timezones WHERE guild_id = ?`
  ),
  upsertPinnedSheet: db.prepare(`
    INSERT INTO pinned_sheets (guild_id, channel_id, message_id, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      message_id = excluded.message_id,
      updated_at = excluded.updated_at
  `),
  getPinnedSheet: db.prepare(
    `SELECT channel_id, message_id FROM pinned_sheets WHERE guild_id = ?`
  ),
  removePinnedSheet: db.prepare(
    `DELETE FROM pinned_sheets WHERE guild_id = ?`
  )
};

export function setUserTimezone(guildId, userId, timezone) {
  stmts.upsertTimezone.run(guildId, userId, timezone, Date.now());
}

export function getUserTimezone(guildId, userId) {
  const row = stmts.getTimezone.get(guildId, userId);
  return row ? row.timezone : null;
}

export function removeUserTimezone(guildId, userId) {
  return stmts.removeTimezone.run(guildId, userId).changes > 0;
}

export function listGuildTimezones(guildId) {
  return stmts.listTimezones.all(guildId);
}

export function setPinnedSheet(guildId, channelId, messageId) {
  stmts.upsertPinnedSheet.run(guildId, channelId, messageId, Date.now());
}

export function getPinnedSheet(guildId) {
  return stmts.getPinnedSheet.get(guildId) || null;
}

export function clearPinnedSheet(guildId) {
  stmts.removePinnedSheet.run(guildId);
}

export default db;
