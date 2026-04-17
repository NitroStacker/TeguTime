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

export { ALL_ZONES };
