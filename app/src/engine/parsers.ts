/** Date, amount, and per-bank identification parsers. */

import {
  AMOUNT_PATTERNS,
  BANK_SIGNATURES,
  BANAMEX_CARD_RE,
  BANAMEX_DEP_RE,
  BBVA_DEST_RE,
  DATE_DMY_PATTERNS,
  DATE_NUMERIC_PATTERNS,
  MONTH_MAP_EN,
  MONTH_MAP_ES,
  MULTILINE_AMOUNT_PATTERNS,
  SANTANDER_CLABE_RE,
  SANTANDER_CONTACT_ACCT_RE,
  SANTANDER_CUENTA_RE,
  SANTANDER_DEBITO_RE,
  SANTANDER_TDC_RE,
  TRAILING_LETTER_RE,
} from "./patterns";
import { cleanBankName } from "./models";

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

// ---------------------------------------------------------------------------
// Santander destination helpers
// ---------------------------------------------------------------------------

/**
 * Try multiple regexes to identify the destination from Santander contact info.
 */
export function extractSantanderDest(
  text: string,
  textUpper: string
): string | null {
  let m = SANTANDER_CLABE_RE.exec(text);
  if (m) {
    let destName = m[1].trim();
    destName = destName.split("-")[0].trim();
    destName = destName.replace(TRAILING_LETTER_RE, "").trim();
    return cleanBankName(destName);
  }

  m = SANTANDER_TDC_RE.exec(text);
  if (m) {
    const bankName = m[1].trim();
    const firstWord = bankName.split(/\s+/)[0].toUpperCase();
    if (["NULL", "NONE", ""].includes(firstWord)) {
      return "OTHER";
    }
    return cleanBankName(firstWord);
  }

  m = SANTANDER_CONTACT_ACCT_RE.exec(text);
  if (m) {
    let destName = m[1].trim();
    destName = destName.split("-")[0].trim();
    return cleanBankName(destName);
  }

  m = SANTANDER_CUENTA_RE.exec(text);
  if (m) {
    let destName = m[1].trim();
    destName = destName.split("-")[0].trim();
    return cleanBankName(destName);
  }

  m = SANTANDER_DEBITO_RE.exec(text);
  if (m) {
    let destName = m[1].trim();
    const firstWord = destName.split(/\s+/)[0].toUpperCase();
    if (["NULL", "NONE", ""].includes(firstWord)) {
      return "OTHER";
    }
    return cleanBankName(destName);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Per-bank parsers
// ---------------------------------------------------------------------------

/** Signature type alias used by the parser dispatch list. */
export type BankParser = (text: string, textUpper: string) => [string, string] | null;

/** AmEx receipts. */
export function parseAmex(text: string, textUpper: string): [string, string] | null {
  const cfg = BANK_SIGNATURES.Amex;
  if (!cfg.source_markers.every((marker: string) => textUpper.includes(marker))) {
    return null;
  }
  const indicator = cfg.source_bank_indicator;
  if (indicator && textUpper.includes(indicator)) {
    return [cleanBankName(indicator), cleanBankName("American Express")];
  }
  return ["UNKNOWN", cleanBankName("American Express")];
}

/** BBVA receipts. */
export function parseBbva(text: string, textUpper: string): [string, string] | null {
  const cfg = BANK_SIGNATURES.BBVA;
  let isBbva = cfg.source_markers.every((marker: string) => textUpper.includes(marker));

  if (!isBbva) {
    for (const altPair of cfg.alt_markers ?? []) {
      if (altPair.every((m: string) => textUpper.includes(m))) {
        isBbva = true;
        break;
      }
    }
  }

  if (!isBbva && textUpper.includes("BBVA")) {
    for (const tdcSet of cfg.own_tdc_markers ?? []) {
      if (tdcSet.every((m: string) => textUpper.includes(m))) {
        isBbva = true;
        break;
      }
    }
  }

  if (!isBbva) {
    for (const debitSet of cfg.debit_card_markers ?? []) {
      if (debitSet.every((m: string) => textUpper.includes(m))) {
        isBbva = true;
        break;
      }
    }
  }

  if (!isBbva) {
    const textNoSpace = textUpper.replace(/ /g, "");
    for (const fuzzySet of cfg.fuzzy_markers ?? []) {
      if (fuzzySet.every((m: string) => textNoSpace.includes(m.replace(/ /g, "")))) {
        console.warn("BBVA matched via fuzzy markers (corrupted text):", fuzzySet);
        isBbva = true;
        break;
      }
    }
  }

  if (!isBbva) {
    return null;
  }

  const debitCardMatched = (cfg.debit_card_markers ?? []).some((debitSet: string[]) =>
    debitSet.every((m: string) => textUpper.includes(m))
  );
  if (debitCardMatched) {
    return [cleanBankName("BBVA"), "OTHER"];
  }

  const m = BBVA_DEST_RE.exec(text);
  if (m) {
    const dest = m[1].trim();
    return [cleanBankName("BBVA"), cleanBankName(dest)];
  }

  const ownTdcMatched = (cfg.own_tdc_markers ?? []).some((tdcSet: string[]) =>
    tdcSet.every((m: string) => textUpper.includes(m))
  );
  if (ownTdcMatched) {
    return [cleanBankName("BBVA"), cleanBankName("BBVA")];
  }

  const textNoSpace = textUpper.replace(/ /g, "");
  for (const fuzzySet of cfg.fuzzy_markers ?? []) {
    if (fuzzySet.every((m: string) => textNoSpace.includes(m.replace(/ /g, "")))) {
      console.warn("BBVA own-TDC matched via fuzzy markers:", fuzzySet);
      return [cleanBankName("BBVA"), cleanBankName("BBVA")];
    }
  }

  return [cleanBankName("BBVA"), "OTHER"];
}

/** Banamex receipts. */
export function parseBanamex(text: string, textUpper: string): [string, string] | null {
  const cfg = BANK_SIGNATURES.Banamex;
  let isBanamex = cfg.source_markers.some((marker: string) => textUpper.includes(marker));
  if (
    !isBanamex &&
    textUpper.includes("PAGO INTERBANCARIO") &&
    textUpper.includes("BANAMEX")
  ) {
    isBanamex = true;
  }
  if (!isBanamex) {
    return null;
  }

  const source = cleanBankName("Banamex");

  const mDep = BANAMEX_DEP_RE.exec(text);
  if (mDep) {
    const depLine = mDep[1].trim();
    const depUpper = depLine.toUpperCase();
    for (const bank of [
      "SANTANDER",
      "BANAMEX",
      "BBVA",
      "BANORTE",
      "HSBC",
      "AZTECA",
      "INBURSA",
      "SCOTIABANK",
      "MERCADO PAGO",
    ]) {
      if (depUpper.includes(bank)) {
        return [source, cleanBankName(bank)];
      }
    }
    const parts = depLine.split("-").map((p) => p.trim());
    if (parts.length >= 2 && parts[1].trim()) {
      return [source, cleanBankName(parts[1])];
    }
    return [source, "OTHER"];
  }

  if (
    textUpper.includes("PAGO A TARJETAS BANAMEX") ||
    textUpper.includes("COMPROBANTE DE PAGO DE TARJETAS")
  ) {
    const mCard = BANAMEX_CARD_RE.exec(text);
    if (mCard) {
      const cardLine = mCard[1].trim();
      const cardName = cardLine.split(".")[0].trim();
      const tdc = cardName ? `TDC ${cardName}` : "TDC Banamex";
      return [source, cleanBankName(tdc)];
    }
    return [source, cleanBankName("TDC Banamex")];
  }

  if (textUpper.includes("PAGO INTERBANCARIO")) {
    return [source, "OTHER"];
  }
  return [source, "OTHER"];
}

/** Santander receipts. */
export function parseSantander(text: string, textUpper: string): [string, string] | null {
  if (!textUpper.includes("BANCO SANTANDER")) {
    return null;
  }
  const source = cleanBankName("Santander");
  const cfg = BANK_SIGNATURES.Santander;

  if (cfg.programmed_tdc && textUpper.includes(cfg.programmed_tdc)) {
    const dest = extractSantanderDest(text, textUpper);
    return [source, dest || "OTHER"];
  }

  if (textUpper.includes("PAGO DE TDC A OTROS BANCOS")) {
    const dest = extractSantanderDest(text, textUpper);
    return [source, dest || "OTHER"];
  }

  if (textUpper.includes("PAGO DE TDC PROPIA")) {
    return [source, cleanBankName("Santander")];
  }

  if (textUpper.includes("TRANSFERENCIA ENVIADA")) {
    const dest = extractSantanderDest(text, textUpper);
    return [source, dest || "OTHER"];
  }

  const dest = extractSantanderDest(text, textUpper);
  if (dest) {
    return [source, dest];
  }
  return [source, "OTHER"];
}

/** Fallback parser for receipts without clear source markers. */
export function parseGeneric(text: string, textUpper: string): [string, string] | null {
  if (
    textUpper.includes("COMPROBANTE DE PAGO DE TARJETAS") &&
    textUpper.includes("BANAMEX")
  ) {
    const mCard = BANAMEX_CARD_RE.exec(text);
    if (mCard) {
      const cardLine = mCard[1].trim();
      const cardName = cardLine.split(".")[0].trim();
      const tdc = cardName ? `TDC ${cardName}` : "TDC Banamex";
      return [cleanBankName("Banamex"), cleanBankName(tdc)];
    }
    return [cleanBankName("Banamex"), cleanBankName("TDC Banamex")];
  }
  if (textUpper.includes("BANAMEX")) {
    return [cleanBankName("Banamex"), "OTHER"];
  }
  if (textUpper.includes("SANTANDER") && !textUpper.includes("BANCO DESTINO:")) {
    return [cleanBankName("Santander"), "OTHER"];
  }
  return null;
}

/** Ordered dispatch list — first non-None wins. */
export const PARSERS: BankParser[] = [
  parseAmex,
  parseBbva,
  parseBanamex,
  parseSantander,
  parseGeneric,
];

