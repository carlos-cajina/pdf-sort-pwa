/** Filename building and deduplication logic. */

import { TransactionInfo } from "./models";

const MONTH_ABBRS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Applies to manual names only — auto names are parity-bound to the Python
// CLI byte-for-byte and never pass through this function. Includes ASCII
// control characters (NUL, C0, DEL): pasted names can carry them, and they
// survive no filesystem cleanly. No Python counterpart exists to mirror —
// the Python CLI has no manual names.
const SANITIZE_RE = /[<>:"/\\|?*\s\x00-\x1f\x7f]/g;

/** Replace filesystem-unsafe characters and whitespace with underscores. */
export function sanitizeFilename(name: string): string {
  return name.replace(SANITIZE_RE, "_");
}

/**
 * Format a number like Python's `f"{x:,.2f}"`.
 *
 * Uses the exact decimal expansion of the IEEE-754 double and rounds
 * half-even at two decimal places by string arithmetic, so binary
 * midpoints such as 0.125 render as "0.12" instead of the half-away
 * result produced by `toFixed`.
 */
export function fmtAmount(x: number): string {
  const negative = x < 0 || Object.is(x, -0);
  const expStr = Math.abs(x).toExponential(100);

  // e.g. "1.23456789000000000000...e+2"
  const match = expStr.match(/^(\d)\.(\d+)e([+-]?\d+)$/);
  if (!match) {
    throw new Error(`Unexpected toExponential output: ${expStr}`);
  }

  const integerDigit = match[1];
  const fracDigits = match[2];
  const exponent = parseInt(match[3], 10);

  const digitStr = integerDigit + fracDigits;
  const point = exponent + 1; // number of digits before the decimal point

  // Round half-even to two decimal places.
  const scale = 2;
  const cut = point + scale; // digits kept for value * 100 before rounding

  const kept: number[] = [];
  for (let i = 0; i < cut; i++) {
    kept.push(i >= 0 && i < digitStr.length ? parseInt(digitStr[i], 10) : 0);
  }

  const guardIdx = cut;
  const guard =
    guardIdx >= 0 && guardIdx < digitStr.length
      ? parseInt(digitStr[guardIdx], 10)
      : 0;

  let roundUp = false;
  if (guard > 5) {
    roundUp = true;
  } else if (guard === 5) {
    let restNonZero = false;
    for (let i = guardIdx + 1; i < digitStr.length; i++) {
      if (digitStr[i] !== "0") {
        restNonZero = true;
        break;
      }
    }
    if (restNonZero) {
      roundUp = true;
    } else {
      const lastKept = kept.length > 0 ? kept[kept.length - 1] : 0;
      roundUp = lastKept % 2 !== 0;
    }
  }

  let scaled: string;
  if (!roundUp) {
    scaled = kept.length > 0 ? kept.map(String).join("") : "0";
  } else {
    const inc = kept.length > 0 ? [...kept] : [0];
    let carry = 1;
    for (let i = inc.length - 1; i >= 0 && carry; i--) {
      const sum = inc[i] + carry;
      inc[i] = sum % 10;
      carry = sum >= 10 ? 1 : 0;
    }
    if (carry) {
      inc.unshift(1);
    }
    scaled = inc.map(String).join("");
  }

  // scaled holds value * 100 as an integer string.
  const padded = scaled.padStart(3, "0");
  const intPart = padded.slice(0, -2);
  const fracPart = padded.slice(-2);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `${negative ? "-" : ""}${grouped}.${fracPart}`;
}

/** e.g. May2026 */
export function fmtMonthYear(d: Date): string {
  return `${MONTH_ABBRS[d.getUTCMonth()]}${d.getUTCFullYear()}`;
}

/** Build target filename from extracted info. Returns null if critical fields are missing. */
export function buildFilename(
  info: TransactionInfo,
  suffix = ""
): string | null {
  if (!info.isComplete()) {
    return null;
  }

  const amountStr = fmtAmount(info.amount!);
  const monthStr = fmtMonthYear(info.date!);
  let base = `transf${info.sourceBank}_to_${info.destBank}_x${amountStr}_${monthStr}`;
  if (suffix) {
    base += `_${suffix}`;
  }
  if (!base.toLowerCase().endsWith(".pdf")) {
    base += ".pdf";
  }
  return base;
}

export type EnginePlanItem = {
  original: string;
  info: TransactionInfo;
  newName?: string | null;
};

/**
 * Assign unique suffixes to colliding target names.
 *
 * Pure: returns a new list of new objects; does not mutate inputs.
 */
export function deduplicate(plan: EnginePlanItem[]): EnginePlanItem[] {
  const nameCounter = new Map<string, number>();
  const result: EnginePlanItem[] = [];

  for (const item of plan) {
    const base = buildFilename(item.info);
    if (base === null) {
      result.push({ ...item, newName: null });
      continue;
    }

    const count = (nameCounter.get(base) ?? 0) + 1;
    nameCounter.set(base, count);

    if (count > 1) {
      const baseNoExt = base.toLowerCase().endsWith(".pdf")
        ? base.slice(0, -4)
        : base;
      result.push({ ...item, newName: `${baseNoExt}_${count}.pdf` });
    } else {
      result.push({ ...item, newName: base });
    }
  }

  return result;
}
