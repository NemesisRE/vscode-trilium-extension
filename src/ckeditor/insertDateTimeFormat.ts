const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Trilium's own version of this plugin defers to the user's `customDateTimeFormat` setting when
// no explicit format is given - there's no equivalent setting here, so this is used as a sensible
// default instead.
const DEFAULT_FORMAT = 'YYYY-MM-DD HH:mm';

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function timezoneOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(absMinutes / 60))}:${pad(absMinutes % 60)}`;
}

/**
 * Formats `date` using the small, fixed set of Day.js-style tokens the "Insert date/time" toolbar
 * button offers (see DATE_TIME_PRESETS in the vendored insert_date_time.ts) - not a general Day.js
 * replacement, just enough tokens to cover those presets.
 */
export function formatDateTime(date: Date, format?: string): string {
  const tokens: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MMMM: MONTH_NAMES[date.getMonth()],
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    D: String(date.getDate()),
    dddd: WEEKDAY_NAMES[date.getDay()],
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
    Z: timezoneOffset(date),
  };

  // Longest/most-specific tokens first so e.g. "MMMM" isn't matched as "MM" + "MM".
  return (format ?? DEFAULT_FORMAT).replace(
    /YYYY|dddd|MMMM|MM|DD|HH|mm|ss|D|Z/g,
    (token) => tokens[token] ?? token,
  );
}
