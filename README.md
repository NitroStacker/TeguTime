# Timezone Bot

A production-ready Discord bot that tracks each member's timezone and maintains a live, auto-updating "timezone sheet" for your server.

- **Canonical IANA zones** stored internally → daylight savings is handled correctly.
- **UTC-offset labels** generated on the fly → the UI shows users what they expect (`UTC-5 / America/New_York`).
- **Autocomplete picker** over the full IANA zone list → searchable by city, region, or offset.
- **Pinned sheet** that updates automatically on timezone / nickname / role / member changes.

---

## File structure

```
timezone-bot/
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── src/
    ├── index.js                  # bot entry point
    ├── config.js                 # env loader / validation
    ├── db.js                     # SQLite layer (better-sqlite3)
    ├── deploy-commands.js        # registers slash commands in your guild
    ├── timezones.js              # IANA list + search + offset formatting
    ├── sheet.js                  # builds sheet data + renders embeds
    ├── pinnedSheet.js            # manages the pinned message lifecycle
    ├── commands/
    │   └── timezone.js           # /timezone and its subcommands
    └── events/
        ├── ready.js              # startup reconciliation
        ├── interactionCreate.js  # slash + autocomplete dispatch
        ├── guildMemberUpdate.js  # auto-refresh on nickname/role changes
        └── guildMemberRemove.js  # cleanup + refresh when a member leaves
```

---

## Setup

### 1. Create the Discord application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. In **Bot**, click **Reset Token** and copy it. (This is `DISCORD_TOKEN`.)
3. On the **General Information** tab, copy the **Application ID**. (This is `DISCORD_CLIENT_ID`.)
4. In **Bot → Privileged Gateway Intents**, enable:
   - ✅ **Server Members Intent** (required — needed to detect nickname / role / leave events)

### 2. Invite the bot to your server

Use this URL (replace `YOUR_CLIENT_ID`):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands&permissions=274877991936
```

That permissions integer grants:
- View Channel
- Send Messages
- Embed Links
- Read Message History
- Manage Messages (to pin the sheet)
- Use Application Commands

### 3. Install and configure

Requires **Node.js ≥ 18.17**.

```bash
cp .env.example .env
# edit .env and fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID
npm install
```

To find `DISCORD_GUILD_ID`: enable **Developer Mode** in Discord (User Settings → Advanced), right-click your server icon, and choose **Copy Server ID**.

### 4. Register slash commands and run

```bash
npm run deploy    # one-time (and any time you change the command schema)
npm start
```

You should see:

```
[ready] Logged in as TimezoneBot#1234
```

Guild-scoped commands appear instantly. Try `/timezone help` in your server.

---

## Example `.env`

```
DISCORD_TOKEN=MTIz...yourTokenHere
DISCORD_CLIENT_ID=123456789012345678
DISCORD_GUILD_ID=987654321098765432
PINNED_CHANNEL_ID=111222333444555666
DATABASE_PATH=./data/timezones.db
```

---

## Commands

| Command | Who | What it does |
|---|---|---|
| `/timezone set <timezone>` | Everyone | Set your timezone. Autocomplete searches IANA names, city names, and UTC offsets. |
| `/timezone remove` | Everyone | Remove yourself from the sheet. |
| `/timezone me` | Everyone | Show your saved timezone and current local time. |
| `/timezone sheet` | Everyone | Print the full sheet in the current channel. |
| `/timezone post-sheet [channel]` | Manage Server | Post (or refresh in-place) the **pinned** sheet. |
| `/timezone help` | Everyone | Show help. |

---

## How the pinned message auto-updates

The pinned sheet is a single Discord message whose `(guild_id, channel_id, message_id)` is stored in the `pinned_sheets` table. Whenever the sheet needs to change, `refreshPinnedSheet(guild)` rebuilds the sheet data and calls `message.edit(...)` on the stored message — so the pin keeps its slot in the channel's pinned list.

Triggers that call the refresh:

1. **`/timezone set`** / **`/timezone remove`** — after the DB write succeeds.
2. **`guildMemberUpdate`** — when a tracked member's nickname or role set changes.
3. **`guildMemberRemove`** — the user is removed from the sheet, then the sheet refreshes.
4. **Startup (`ready`)** — catches up on anything that happened while the bot was offline.

If the message or channel was deleted, the refresh clears its DB record silently instead of erroring. Running `/timezone post-sheet` again will put a fresh pinned message back.

To move the pinned sheet to a different channel, run `/timezone post-sheet channel:#new-channel` — the old pin is unpinned and deleted, a new one is posted and pinned.

---

## Required bot permissions & intents

**Gateway intents** (set in your code and in the Developer Portal):

- `GUILDS` — basic guild metadata
- `GUILD_MEMBERS` *(privileged)* — required for nickname/role/leave events

**Channel permissions** where the pinned sheet lives:

- View Channel
- Send Messages
- Embed Links
- Read Message History
- Manage Messages (to pin / unpin)

**Application-wide:**

- Use Application Commands

---

## Data model

```sql
-- one row per (guild, user); user_id is the true primary key so
-- nickname/role changes never break data
CREATE TABLE user_timezones (
  guild_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  timezone   TEXT    NOT NULL,   -- IANA zone, e.g. "America/New_York"
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- tracks the pinned message per guild
CREATE TABLE pinned_sheets (
  guild_id   TEXT    PRIMARY KEY,
  channel_id TEXT    NOT NULL,
  message_id TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Rows for users who leave the guild are cleaned up by the `guildMemberRemove` handler, and `buildSheetData` prunes any stragglers it encounters (e.g., leaves that happened while the bot was offline and somehow slipped past the `ready` reconciliation).

---

## Notes on the IANA zone list

The zone list comes from `Intl.supportedValuesOf('timeZone')` — so it's always in sync with the JS runtime's tz database and never goes stale. Offsets are computed with `luxon`'s `DateTime.setZone(tz).offset`, which respects DST automatically. The UTC-offset labels shown in the UI (`UTC-5 / America/New_York`) are generated at display time — so when the US springs forward, `America/New_York` smoothly flips from `UTC-5` to `UTC-4` without anyone having to re-set their timezone.

---

## Running in production

- `npm start` runs the bot in the foreground.
- For a service manager, use `systemd`, `pm2`, or Docker as you prefer. The bot re-establishes state on `ready`, so restarts are safe.
- SQLite is in WAL mode — a single process is expected.
- The bot handles `SIGINT` / `SIGTERM` and destroys the Discord client cleanly before exiting.
