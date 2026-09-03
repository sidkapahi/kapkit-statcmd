// IANA timezone list for the TIMEZONE dropdown. The "Today" datapoints
// (`{{rating.diff}}`, `{{elo.diff}}`, `{{todays.*}}`) are computed by the Worker
// relative to local midnight in this timezone, so it must be a real IANA name
// (e.g. `America/Toronto`) that the Worker can pass to `Intl`.

// Modern browsers expose the full list; fall back to a compact common set on the
// rare engine that doesn't support Intl.supportedValuesOf.
export function allTimezones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf;
    if (typeof fn === 'function') {
      const list = fn('timeZone');
      if (Array.isArray(list) && list.length) return list;
    }
  } catch {
    /* fall through to the static list */
  }
  return COMMON_TIMEZONES;
}

// The visitor's own timezone, used as the default selection. Falls back to UTC.
export function defaultTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && isValidTimezone(tz)) return tz;
  } catch {
    /* ignore */
  }
  return 'UTC';
}

// Whether a string is a timezone the runtime accepts (used to validate a
// restored URL value before trusting it).
export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// A small offline fallback so the dropdown is never empty on an engine without
// Intl.supportedValuesOf. Not exhaustive — the runtime list above is used
// everywhere it exists.
const COMMON_TIMEZONES: string[] = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
];
