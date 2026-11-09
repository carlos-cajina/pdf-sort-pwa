/** Date, amount, and per-bank identification parsers. */

import {
  AMOUNT_PATTERNS,
  DATE_DMY_PATTERNS,
  DATE_NUMERIC_PATTERNS,
  MONTH_MAP_EN,
  MONTH_MAP_ES,
  MULTILINE_AMOUNT_PATTERNS,
} from "./patterns";

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

/**
 * Build a UTC-midnight Date for the given calendar triple.
 * Returns null if the triple does not denote a real calendar date
 * (mirroring Python's datetime(year, month, day) ValueError behaviour).
 */
function buildUtcDate(year: number, month: number, day: number): Date | null {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(0, 0, 0, 0);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

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

  return buildUtcDate(year, month, day);
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
      const result = buildUtcDate(year, month, day);
      if (!result) {
        continue;
      }
      return result;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Amount parsing
// ---------------------------------------------------------------------------

/**
 * Extract the principal transfer amount in MXN.
 *
 * Pass 1: full-text multi-line patterns (e.g. Santander label/value
 * on separate lines).
 * Pass 2: per-line patterns with fee/commission exclusion.
 */
export function extractAmount(text: string): number | null {
  const feeKeywords = [
    "COMISIÓN",
    "COMISION",
    "IVA",
    "COSTO",
    "IMPUESTO",
    "FEE",
  ];
  const labelKeywords = ["IMPORTE", "MONTO"];

  for (const pattern of MULTILINE_AMOUNT_PATTERNS) {
    const m = pattern.exec(text);
    if (m) {
      const captured = m[1];
      if (captured === undefined) {
        continue;
      }
      const val = Number(captured.replace(/,/g, ""));
      if (!Number.isNaN(val) && val >= 0) {
        return val;
      }
    }
  }

  const lines = text.split("\n");
  for (const pattern of AMOUNT_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineUpper = line.toUpperCase();
      if (feeKeywords.some((kw) => lineUpper.includes(kw))) {
        continue;
      }
      const isLabeled = labelKeywords.some((kw) => lineUpper.includes(kw));
      if (!isLabeled) {
        const nextLine =
          i + 1 < lines.length ? lines[i + 1].toUpperCase() : "";
        if (feeKeywords.some((kw) => nextLine.includes(kw))) {
          continue;
        }
      }
      const m = pattern.exec(line);
      if (m) {
        const captured = m[1];
        if (captured === undefined) {
          continue;
        }
        const amountStr = captured.replace(/,/g, "");
        const val = Number(amountStr);
        if (!Number.isNaN(val) && val >= 0) {
          return val;
        }
      }
    }
  }

  return null;
}
