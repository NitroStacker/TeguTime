import { DateTime } from 'luxon';

// Full IANA zone list supported by the JS runtime (Node 18+).
// Using this as the source of truth means we never hard-code a stale list.
const ALL_ZONES =
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : [];

if (ALL_ZONES.length === 0) {
  throw new Error(
    'Intl.supportedValuesOf("timeZone") is unavailable. Please upgrade to Node.js 18.17 or newer.'
  );
}

// Zones surfaced first when the user opens autocomplete with an empty query.
// Ordered roughly west-to-east so the initial list reads like a world clock.
const POPULAR = [
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
  'UTC'
];

export function isValidTimezone(tz) {
  return typeof tz === 'string' && ALL_ZONES.includes(tz);
}

/**
 * Current UTC offset (in minutes) for a given IANA zone, accounting for DST.
 * Returns null if the zone is invalid.
 */
export function getOffsetMinutes(tz) {
  const dt = DateTime.now().setZone(tz);
  return dt.isValid ? dt.offset : null;
}

/**
 * Format a minutes-offset as "UTC", "UTC+5", "UTC-3:30", etc.
 */
export function formatOffset(offsetMinutes) {
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
export function formatLabel(tz) {
  const offset = getOffsetMinutes(tz);
  if (offset === null) return tz;
  return `${formatOffset(offset)} / ${tz}`;
}

/**
 * Current local time in a zone, formatted as HH:mm.
 */
export function getCurrentTime(tz) {
  return DateTime.now().setZone(tz).toFormat('HH:mm');
}

/**
 * Search zones for an autocomplete query. Matches IANA names, friendly city names,
 * and UTC offset strings. Returns up to `limit` results sorted by match quality and offset.
 */
export function searchTimezones(query, limit = 25) {
  const trimmed = (query ?? '').trim();
  const lower = trimmed.toLowerCase();

  if (!trimmed) {
    return POPULAR.filter(isValidTimezone)
      .slice(0, limit)
      .map((tz) => ({ value: tz, label: formatLabel(tz) }));
  }

  const results = [];
  for (const tz of ALL_ZONES) {
    const tzLower = tz.toLowerCase();
    const label = formatLabel(tz).toLowerCase();
    const city = tz.split('/').pop().replace(/_/g, ' ').toLowerCase();

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
    label: formatLabel(r.tz)
  }));
}

export { ALL_ZONES };
