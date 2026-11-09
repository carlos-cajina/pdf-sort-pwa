/**
 * Compiled regex patterns and configuration tables for extraction.
 *
 * This module is pure data: no logic, no side effects. Importing it should
 * not do any work beyond constructing regexes.
 */

export const MONTH_MAP_ES: Record<string, number> = {
  ene: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dic: 12,
};

export const MONTH_MAP_EN: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export const STRIP_CORRUPT_RE = /[\uffff\ufffd\x00]/g;

export const DATE_DMY_PATTERNS: [RegExp, "%b" | "%y"][] = [
  [/(\d{1,2})\/([A-Za-z]{3,4})\/(\d{4})/, "%b"],
  [/(\d{1,2})\/([A-Za-z]{3,4})\/(\d{2})/, "%y"],
  [/Fecha de operación\s+(\d{1,2})\/([A-Za-z]{3,4})\/(\d{4})/, "%b"],
  [/Fecha y hora de operación\s+(\d{1,2})\/([A-Za-z]{3,4})\/(\d{4})/, "%b"],
  [/Fecha y hora de operación\s+(\d{1,2})\/([A-Za-z]{3,4})\/(\d{2})/, "%y"],
  [/Fecha y hora de aplicación\s+(\d{1,2})\/([A-Za-z]{3,4})\/(\d{4})/, "%b"],
  [/(\d{1,2})\s+(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Sept|Oct|Nov|Dic)\s+(\d{4})/i, "%b"],
  [/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/, "%b"],
  [/Fecha de aplicación:\s*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/, "%b"],
  [/Fecha\s*\n(\d{1,2})\s+([A-Za-z]{3,4}),\s*(\d{4})/, "%b"],
  [/Fecha\s+(\d{1,2})\s+([A-Za-z]{3,4}),?\s*(\d{4})/, "%b"],
];

export const DATE_NUMERIC_PATTERNS: RegExp[] = [
  /Fecha de operación:\s*(\d{2})\/(\d{2})\/(\d{4})\b/,
  /Fecha de operación:\s*(\d{2})-(\d{2})-(\d{4})\b/,
  /Fecha de aplicación:\s*(\d{2})-(\d{2})-(\d{4})\b/,
  /Fecha:\s*(\d{2})\/(\d{2})\/(\d{4})\b/,
  /\b(\d{2})\/(\d{2})\/(\d{4})/,
  /\b(\d{2})-(\d{2})-(\d{4})\b/,
];

export const AMOUNT_PATTERNS: RegExp[] = [
  /Importe del pago en\s*\$?\s*([\d,]+\.\d{2})/i,
  /Importe\s+\$?\s*([\d,]+\.\d{2})/i,
  /Importe a pagar:\s*\$?\s*([\d,]+\.\d{2})/,
  /Importe:\s*\$?\s*([\d,]+\.\d{2})/,
  /Importe Pagado:\s*\$?\s*([\d,]+\.\d{2})/,
  /Importe del pago en Pesos\s*\n\$?\s*([\d,]+\.\d{2})/,
  /Importe total \(MXN\)\s*\$?\s*([\d,]+)(?:\s|$)/,
  /Importe Pagado:\s*\$?\s*([\d,]+)(?:\s|$)/,
  /Importe:\s*\$?\s*([\d,]+)(?:\s|$)/,
  /Monto\s*\$?\s*([\d,]+\.\d{2})/,
  /^\s*\$\s*([\d,]+\.\d{2})/,
  /^\s*\$\s*([\d,]+)(?:\s|$)/,
];

export const MULTILINE_AMOUNT_PATTERNS: RegExp[] = [
  /\$\s*([\d,]+\.\d{2})\s*\nImporte total/,
  /Importe total \(MXN\)\s*\n\$\s*([\d,]+\.\d{2})/,
  /Importe total \(MXN\)\s*\n\$\s*([\d,]+)(?:\s|$)/,
  /Monto\s*\n\$\s*([\d,]+\.\d{2})/,
  /Importe Pagado:\s*\n\$\s*([\d,]+)(?:\s|$)/,
  /Importe Pagado:\s*\n\$\s*([\d,]+\.\d{2})/,
];

export const BBVA_DEST_RE = /Banco destino:\s*(\S+)/i;
export const BANAMEX_DEP_RE = /Cuenta de depósito:\s*(.+?)(?:\n|$)/;
export const BANAMEX_CARD_RE = /Tarjeta de crédito\s*\n?([^\n]+)/;
export const SANTANDER_TDC_RE = /TDC\s+\*\d+\s*-\s*([^\n]+)/;
export const SANTANDER_CLABE_RE = /Número de cuenta\s+CLABE\s+\*\d+\s*-\s*([^\n]+)/;
export const SANTANDER_CONTACT_ACCT_RE = /Número de cuenta\s+\*\d+\s*-\s*([^\n]+)/;
export const SANTANDER_CUENTA_RE = /Cuenta\s+\*\d+\s*-\s*([^\n]+)/;
export const SANTANDER_DEBITO_RE = /Tarjeta de débito\s+\*\d+\s*-\s*([^\n]+)/;
export const TRAILING_LETTER_RE = /\s+[A-Z]$/;

export interface BankSignature {
  source_markers: string[];
  alt_markers?: string[][];
  own_tdc_markers?: string[][];
  debit_card_markers?: string[][];
  fuzzy_markers?: string[][];
  destination_re?: RegExp;
  interbank_marker?: string;
  tdc_other?: string;
  tdc_own?: string;
  transfer?: string;
  programmed_tdc?: string;
  clabe_prefixes?: Record<string, string>;
  source_bank_indicator?: string;
}

export const BANK_SIGNATURES: Record<string, BankSignature> = {
  BBVA: {
    source_markers: ["BBVA", "BANCO DESTINO:"],
    alt_markers: [
      ["BANCO DESTINO:", "ENLACE PERSONAL"],
      ["BANCO DESTINO:", "TRANSFERENCIAS A OTROS BANCOS SPEI"],
    ],
    own_tdc_markers: [
      ["BBVA", "CUENTA DESTINO", "TARJETA DE CRÉDITO"],
      ["BBVA", "TIPO DE OPERACIÓN", "TRASPASO CUENTAS PROPIAS"],
    ],
    debit_card_markers: [["TARJETA DE DÉBITO", "CUENTA DESTINO"]],
    fuzzy_markers: [
      ["BBV", "CUENT", "DESTINO", "TARJET", "CRÉDITO"],
      ["BBV", "TIPO", "OPER", "TRSPSO", "CUENTS", "PROPIS"],
    ],
    destination_re: BBVA_DEST_RE,
  },
  Banamex: {
    source_markers: [
      "MI CUENTA BANAMEX",
      "MICUENTA BANAME",
      "CUENTAS BANAMEX",
      "PAGO A TARJETAS BANAMEX",
      "COMPROBANTE DE PAGO DE TARJETAS",
    ],
    interbank_marker: "PAGO INTERBANCARIO",
  },
  Santander: {
    source_markers: ["BANCO SANTANDER"],
    tdc_other: "PAGO DE TDC A OTROS BANCOS",
    tdc_own: "PAGO DE TDC PROPIA",
    transfer: "TRANSFERENCIA ENVIADA",
    programmed_tdc: "PROGRAMASTE EL PAGO DE UNA TARJETA",
    clabe_prefixes: {
      "50": "Santander",
      "51": "Santander",
      "52": "Santander",
      "53": "Santander",
      "54": "Santander",
      "55": "Santander",
      "56": "Santander",
      "57": "Santander",
      "58": "Santander",
      "59": "Santander",
    },
  },
  Amex: {
    source_markers: ["AMERICAN EXPRESS", "CONFIRM PAYMENT"],
    source_bank_indicator: "SANTANDER",
  },
};

export const ACRONYMS = new Set(["BBVA", "HSBC", "CIH", "SPEI", "TDC"]);

export const BANK_ALIASES: Record<string, string> = {
  "BBVA MEXICO": "BBVA",
  "BBVA MEX": "BBVA",
  "BBVA BANCOMER": "BBVA",
  BANAMEX: "Banamex",
  SANTANDER: "Santander",
  BANORTE: "Banorte",
  HSBC: "HSBC",
  "MERCADO PAGO": "MercadoPago",
  "MERCADO PAGO W": "MercadoPago",
  "TDC COSTCO BANAME": "Costco",
  "NU MEXICO": "NuMexico",
  NU: "NuMexico",
  "AMERICAN EXPRESS": "Amex",
};
