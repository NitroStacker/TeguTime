import { DateTime } from 'luxon';

// Full IANA zone list supported by the JS runtime (Node 18+).
// Using this as the source of truth means we never hard-code a stale list.
const ALL_ZONES: readonly string[] =
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

if (ALL_ZONES.length === 0) {
  throw new Error(
    'Intl.supportedValuesOf("timeZone") is unavailable. Please upgrade to Node.js 18.17 or newer.',
  );
}

// Featured zones, shown first when the autocomplete query is empty.
// Ordered roughly west-to-east so the initial list reads like a world clock.
const POPULAR: readonly string[] = [
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Atlantic/Azores',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Athens',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

export interface TimezoneChoice {
  value: string;
  label: string;
}

export function isValidTimezone(tz: unknown): tz is string {
  return typeof tz === 'string' && ALL_ZONES.includes(tz);
}

/**
 * Current UTC offset in minutes for an IANA zone, DST-aware.
 * Returns null for invalid zones.
 */
export function getOffsetMinutes(tz: string): number | null {
  const dt = DateTime.now().setZone(tz);
  return dt.isValid ? dt.offset : null;
}

/**
 * Format a minutes-offset as a friendly UTC label: "UTC", "UTC+5", "UTC-3:30".
 */
export function formatOffset(offsetMinutes: number): string {
  if (offsetMinutes === 0) return 'UTC';
  const sign = offsetMinutes > 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`;
}

/**
 * Human-friendly label: "UTC-5 / America/New_York".
 */
export function formatLabel(tz: string): string {
  const offset = getOffsetMinutes(tz);
  if (offset === null) return tz;
  return `${formatOffset(offset)} / ${tz}`;
}

/**
 * Current local time in a zone as HH:mm.
 */
export function getCurrentTime(tz: string): string {
  return DateTime.now().setZone(tz).toFormat('HH:mm');
}

/**
 * Autocomplete search. Matches IANA names, city names, and UTC offset strings.
 * Returns up to `limit` results, ranked by match quality then current offset.
 */
export function searchTimezones(query: string | null | undefined, limit = 25): TimezoneChoice[] {
  const trimmed = (query ?? '').trim();
  const lower = trimmed.toLowerCase();

  if (!trimmed) {
    return POPULAR.filter(isValidTimezone)
      .slice(0, limit)
      .map((tz) => ({ value: tz, label: formatLabel(tz) }));
  }

  const results: Array<{ tz: string; score: number; offset: number }> = [];
  for (const tz of ALL_ZONES) {
    const tzLower = tz.toLowerCase();
    const label = formatLabel(tz).toLowerCase();
    const city = (tz.split('/').pop() ?? tz).replace(/_/g, ' ').toLowerCase();

    let score = -1;
    if (tzLower === lower) score = 0;
    else if (tzLower.startsWith(lower)) score = 1;
    else if (label.startsWith(lower)) score = 2;
    else if (city.startsWith(lower)) score = 3;
    else if (tzLower.includes(lower)) score = 4;
    else if (label.includes(lower)) score = 5;
    else if (city.includes(lower)) score = 6;

    if (score >= 0) {
      results.push({ tz, score, offset: getOffsetMinutes(tz) ?? 0 });
    }
  }

  results.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.offset !== b.offset) return a.offset - b.offset;
    return a.tz.localeCompare(b.tz);
  });

  return results.slice(0, limit).map((r) => ({
    value: r.tz,
    label: formatLabel(r.tz),
  }));
}

// ---- Scheduling helpers (Phase 1b) ----

/**
 * Parse a user-entered date/time string in the given IANA timezone and return
 * it as a UTC epoch millisecond timestamp. Returns null for invalid input.
 *
 * Accepted formats:
 *   - `yyyy-MM-dd HH:mm`       (24-hour, e.g. "2026-04-20 14:00")
 *   - `yyyy-MM-dd HH:mm:ss`
 *   - `yyyy-MM-ddTHH:mm`       (ISO-ish, e.g. "2026-04-20T14:00")
 *   - `yyyy-MM-ddTHH:mm:ss`
 */
export function parseDateTimeInZone(input: string, tz: string): number | null {
  if (!input || !isValidTimezone(tz)) return null;
  const trimmed = input.trim();

  const formats = [
    'yyyy-MM-dd HH:mm',
    'yyyy-MM-dd HH:mm:ss',
    "yyyy-MM-dd'T'HH:mm",
    "yyyy-MM-dd'T'HH:mm:ss",
  ];

  for (const format of formats) {
    const dt = DateTime.fromFormat(trimmed, format, { zone: tz });
    if (dt.isValid) return dt.toMillis();
  }

  // Graceful fallback — try luxon's ISO parser as a last resort.
  const iso = DateTime.fromISO(trimmed, { zone: tz });
  return iso.isValid ? iso.toMillis() : null;
}

/**
 * Discord native timestamp tag. Rendered by each viewer's client in their
 * local timezone automatically. Pass a UTC epoch ms value.
 */
export function discordTimestamp(
  utcMs: number,
  style: 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R' = 'F',
): string {
  return `<t:${Math.floor(utcMs / 1000)}:${style}>`;
}

/**
 * Compact human-readable duration for short countdowns and status cards.
 * Examples: "3d 4h", "4h 12m", "12m 30s", "now".
 */
export function formatDurationShort(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 1000) return 'now';

  const seconds = Math.floor(abs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Format a UTC timestamp authored in `authorTz` as "Mon 2026-04-20 14:00 UTC-5".
 * Useful in embeds where we want a concrete, unambiguous reference line below
 * Discord's auto-localized `<t:...:F>` tag.
 */
export function formatInAuthoredZone(utcMs: number, authorTz: string): string {
  const dt = DateTime.fromMillis(utcMs, { zone: authorTz });
  if (!dt.isValid) return new Date(utcMs).toISOString();
  const offset = formatOffset(dt.offset);
  return `${dt.toFormat('ccc yyyy-MM-dd HH:mm')} ${offset}`;
}

export { ALL_ZONES };
