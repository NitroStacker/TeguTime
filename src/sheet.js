import { EmbedBuilder } from 'discord.js';
import { listGuildTimezones, removeUserTimezone } from './db.js';
import { getOffsetMinutes, formatOffset } from './timezones.js';

const NAME_MAX = 24;
const ROLE_MAX = 20;
const CHUNK_CHARS = 1800; // keep each code block under Discord's 4096 embed-description limit

function truncate(str, max) {
  if (!str) return '';
  const chars = [...str];
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : str;
}

function padEnd(str, width) {
  const len = [...str].length;
  return len >= width ? str : str + ' '.repeat(width - len);
}

/**
 * Collect the rows needed to render the sheet for a guild.
 * Resolves each saved user to a live GuildMember so the display name and
 * highest non-@everyone role are always fresh. Stale rows (user left the
 * guild) are pruned from the database as a side effect.
 */
export async function buildSheetData(guild) {
  const rows = listGuildTimezones(guild.id);
  if (rows.length === 0) return [];

  try {
    await guild.members.fetch({ user: rows.map((r) => r.user_id) });
  } catch {
    // Partial failures are fine — we'll skip any member we can't resolve.
  }

  const everyoneId = guild.id;
  const data = [];

  for (const row of rows) {
    const member = guild.members.cache.get(row.user_id);
    if (!member) {
      // User no longer in the guild — clean up to keep the sheet honest.
      removeUserTimezone(guild.id, row.user_id);
      continue;
    }

    const highestRole = member.roles.cache
      .filter((r) => r.id !== everyoneId)
      .sort((a, b) => b.position - a.position)
      .first();

    data.push({
      userId: member.id,
      displayName: member.displayName,
      role: highestRole ? highestRole.name : '—',
      timezone: row.timezone,
      offset: getOffsetMinutes(row.timezone) ?? 0
    });
  }

  data.sort((a, b) => {
    if (a.offset !== b.offset) return a.offset - b.offset;
    return a.displayName.localeCompare(b.displayName, undefined, {
      sensitivity: 'base'
    });
  });

  return data;
}

/**
 * Render sheet rows as one or more EmbedBuilders. Uses a code block so
 * Discord renders a monospace table where our padding actually aligns.
 */
export function renderSheetEmbeds(guild, data) {
  const title = `🕒 ${guild.name} — Timezone Sheet`;

  if (data.length === 0) {
    return [
      new EmbedBuilder()
        .setTitle(title)
        .setColor(0x5865f2)
        .setDescription(
          '_No members have set a timezone yet. Use `/timezone set` to add yours._'
        )
        .setTimestamp(new Date())
    ];
  }

  const nameWidth = Math.min(
    NAME_MAX,
    Math.max(4, ...data.map((d) => [...d.displayName].length))
  );
  const roleWidth = Math.min(
    ROLE_MAX,
    Math.max(4, ...data.map((d) => [...d.role].length))
  );

  const header =
    padEnd('Name', nameWidth) +
    '  ' +
    padEnd('Role', roleWidth) +
    '  ' +
    'Timezone';
  const divider = '─'.repeat([...header].length);

  const lines = data.map((d) => {
    const name = padEnd(truncate(d.displayName, nameWidth), nameWidth);
    const role = padEnd(truncate(d.role, roleWidth), roleWidth);
    const tz = `${formatOffset(d.offset)} / ${d.timezone}`;
    return `${name}  ${role}  ${tz}`;
  });

  // Split into chunks so a huge guild doesn't blow past the embed limit.
  const chunks = [];
  let buf = [header, divider];
  let bufLen = header.length + divider.length + 2;
  for (const line of lines) {
    if (bufLen + line.length + 1 > CHUNK_CHARS) {
      chunks.push(buf.join('\n'));
      buf = [header, divider];
      bufLen = header.length + divider.length + 2;
    }
    buf.push(line);
    bufLen += line.length + 1;
  }
  if (buf.length > 2) chunks.push(buf.join('\n'));

  return chunks.map((chunk, i) => {
    const embed = new EmbedBuilder()
      .setTitle(chunks.length > 1 ? `${title} (${i + 1}/${chunks.length})` : title)
      .setColor(0x5865f2)
      .setDescription('```\n' + chunk + '\n```')
      .setTimestamp(new Date());
    if (i === chunks.length - 1) {
      embed.setFooter({
        text: `${data.length} member${data.length === 1 ? '' : 's'} • Sorted by UTC offset`
      });
    }
    return embed;
  });
}
