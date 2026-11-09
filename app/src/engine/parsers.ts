/** Date, amount, and per-bank identification parsers. */

import {
  DATE_DMY_PATTERNS,
  DATE_NUMERIC_PATTERNS,
  MONTH_MAP_EN,
  MONTH_MAP_ES,
} from "./patterns";

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

/** Parse day/month/year triplet into a UTC-midnight Date, or null if invalid. */
function parseDateDmy(
  dayS: string,
  monS: string,
  yearS: string,
  fmt: "%b" | "%y"
): Date | null {
  const day = parseInt(dayS, 10);
  const monLower = monS.toLowerCase();

  let year: number;
  if (fmt === "%y") {
    const y = parseInt(yearS, 10);
    // Receipts from 1990s use 50-99, 2000s+ use 00-49
    year = y < 50 ? 2000 + y : 1900 + y;
  } else {
    year = parseInt(yearS, 10);
  }

  let month: number | undefined;
  if (monLower in MONTH_MAP_ES) {
    month = MONTH_MAP_ES[monLower];
  } else if (monLower in MONTH_MAP_EN) {
    month = MONTH_MAP_EN[monLower];
  }

  if (month === undefined) {
    return null;
  }

  const timestamp = Date.UTC(year, month - 1, day);
  if (isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp);
}

/** Extract a date from receipt text as a UTC-midnight Date. */
export function parseDate(text: string): Date | null {
  for (const [pattern, fmt] of DATE_DMY_PATTERNS) {
    const m = pattern.exec(text);
    if (m) {
      const result = parseDateDmy(m[1], m[2], m[3], fmt);
      if (result) {
        return result;
      }
    }
  }

  for (const pattern of DATE_NUMERIC_PATTERNS) {
    const m = pattern.exec(text);
    if (m) {
      const year = parseInt(m[3], 10);
      const month = parseInt(m[2], 10);
      const day = parseInt(m[1], 10);
      const timestamp = Date.UTC(year, month - 1, day);
      if (isNaN(timestamp)) {
        continue;
      }
      return new Date(timestamp);
    }
  }

  return null;
}
