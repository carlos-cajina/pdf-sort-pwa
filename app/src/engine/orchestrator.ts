/** Thin orchestrator that wires the per-bank parsers together. */

import { TransactionInfo, cleanText } from "./models";
import { PARSERS, parseDate, extractAmount } from "./parsers";

/** Return [sourceBank, destinationBank] for a receipt's text. */
export function identifyBanks(text: string): [string, string] {
  const textUpper = text.toUpperCase();
  for (const parser of PARSERS) {
    const result = parser(text, textUpper);
    if (result !== null) {
      return result;
    }
  }
  return ["UNKNOWN", "UNKNOWN"];
}

/** Extract date, banks, and amount from receipt text. */
export function extractInfo(text: string): TransactionInfo {
  text = cleanText(text);
  const dt = parseDate(text);
  const [source, dest] = identifyBanks(text);
  const amount = extractAmount(text);
  return new TransactionInfo(dt, source, dest, amount);
}
