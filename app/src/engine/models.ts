/** Data model and low-level text utilities. */

import { ACRONYMS, BANK_ALIASES, STRIP_CORRUPT_RE } from "./patterns";

/** Extracted metadata from a single transfer receipt. */
export class TransactionInfo {
  constructor(
    readonly date: Date | null,
    readonly sourceBank: string,
    readonly destBank: string,
    readonly amount: number | null
  ) {}

  isComplete(): boolean {
    return (
      this.date !== null &&
      this.amount !== null &&
      this.sourceBank !== "UNKNOWN"
    );
  }
}

/** Remove U+FFFF, U+FFFD, and null bytes from extracted PDF text. */
export function cleanText(text: string): string {
  return text.replace(STRIP_CORRUPT_RE, "");
}

/**
 * Capitalize the first letter of each word and lower-case the rest,
 * mirroring Python's str.title().
 */
function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Normalize bank name: resolve aliases, UPPER for acronyms, PascalCase otherwise. */
export function cleanBankName(name: string): string {
  const upperKey = name.toUpperCase().trim();
  if (upperKey in BANK_ALIASES) {
    return BANK_ALIASES[upperKey];
  }

  const upper = upperKey.replace(/ /g, "");
  if (ACRONYMS.has(upper)) {
    return upper;
  }

  if (name === name.toUpperCase() || name === name.toLowerCase()) {
    return toTitleCase(name).replace(/ /g, "");
  }

  return name.replace(/ /g, "");
}
