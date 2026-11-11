import { describe, it, expect } from "vitest";
import {
  parseAmex,
  parseBbva,
  parseBanamex,
  parseSantander,
  parseGeneric,
  PARSERS,
  extractSantanderDest,
} from "../parsers";
import { identifyBanks, extractInfo } from "../orchestrator";


// ---------------------------------------------------------------------------
// Fixture texts (mirroring tests/test_extraction.py)
// ---------------------------------------------------------------------------
const BBVA_TEXT = `\
CAJINA MORALES CARLOS ERNESTO
A otros bancos - Cuenta CLABE
Comprobante 10/May/2026 08:19:07
Cuenta de retiro: 1572633671
Tipo de operación: Transferir - Otros bancos - Cuenta CLABE
Banco destino: BANAMEX
Importe: $128.00
Comisión por Transferencia - envío; (SPEI; $5.00 + IVA
Fecha de operación: 10/05/2026
BBVA México, S.A., Institución de Banca Múltiple, Grupo Financiero BBVA México.
`;

const BBVA_SPEI_NO_BRAND_TEXT = `\
Operación:Transferencias a otros bancos SPEI
Fecha de operación:22-04-2026
Hora de operación:09:46 horas
Cuenta origen:ENLACE PERSONAL - 1194086203
Nombre de ordenante:CARLOS ERNESTO CAJINA MORALES
Cuenta destino:CARLOS_SANTANDER - 014320606103186784
Banco destino:Santander
Importe a pagar:$ 14,080.00 MN
`;

const BBVA_OWN_TDC_TEXT = `\
CAJINA MORALES CARLOS ERNESTO
Tarjeta de crédito
Comprobante 04 May 2026 15:34:51
CUENTA DE RETIRO  1572633671
CUENTA DESTINO  4772133048882663
IMPORTE  $10,000.00
FECHA DE OPERACIÓN  04/05/2026 3:34:48 PM
TIPO DE OPERACIÓN  TRASPASO CUENTAS PROPIAS (TDC)
FOLIO DE OPERACIÓN  20050007
BBVA México, S.A., Institución de Banca Múltiple, Grupo Financiero BBVA México.
`;

const BANAMEX_INTERBANK_TEXT = `\
Pago interbancario
CARLOS ERNESTO CAJINA MORALES 30 Abr 2026 04:31:50
Cuenta de retiro: MiCuenta Banamex **954 MXN
Cuenta de depósito: CARLOS SANTANDER-SANTANDER-CLABE-784-
Importe: $ 52,713.61
Fecha: 30 Abr 2026
`;

const BANAMEX_TDC_TEXT = `\
Comprobante de pago de tarjetas
30 Apr 2026 4:32:56 h
Pago a tarjetas Banamex
CARLOS ERNESTO CAJINA MORALES
Tarjeta de crédito
Costco Baname... **280
Importe: $3,500.00
Cuenta de retiro
MiCuenta Baname... **954
`;

const SANTANDER_TDC_OTHER_TEXT = `\
Banco Santander (México), S.A.
Pago de TDC a otros bancos
Cuenta de origen
CTA *8678 Supercuenta Cheques
Fecha de operación 30/abr/2026
Número de tarjeta TDC *2663 - BBVA Bancomer
Importe total (MXN)
$3,000.00
`;

const SANTANDER_TDC_OWN_TEXT = `\
Banco Santander (México), S.A.
Pago de TDC propia
Cuenta de origen
CTA *8678 Supercuenta Cheques
Fecha de operación 30/abr/2026
Nombre SANTANDER LIKEU
$8,139.28
Importe total (MXN)
`;

const SANTANDER_TRANSFER_TEXT = `\
Banco Santander (México), S.A.
Transferencia enviada, en proceso de validación
Cuenta de origen CTA *8678 Supercuenta Cheques
Fecha y hora de operación 30/abr/2026 - 04:35:52 h
Número de cuenta CLABE *2072 - Mercado Pago W
$207.78
Importe total (MXN)
`;

const SANTANDER_PROGRAMMED_TEXT = `\
Banco Santander (México), S.A.
¡Programaste el pago de una tarjeta!
Cuenta de origen CTA *8678 Supercuenta Cheques
Fecha y hora de operación 22/may/26 - 21:27:42
Número de tarjeta TDC *2663 - BBVA BANCOMER
Motivo o concepto Pago a BBVA Oro
$10,224.01
Importe Pagado:
`;

const SANTANDER_TO_NU_TEXT = `\
Banco Santander (México), S.A.
Transferencia a otros bancos - SPEI
Cuenta origen CTA *8678 Supercuenta Cheques
Fecha y hora de operación 24/abr/2026 - 17:15:29 h
Número de cuenta *2832 - Nu Mexico
$500.00
Importe total (MXN)
`;

const SANTANDER_TO_SANTANDER_TEXT = `\
Banco Santander (México), S.A.
Transferencia a terceros Santander
Cuenta de origen CTA *8678 Supercuenta Cheques
Fecha de operación 14/may/2026
Cuenta *5697 - Santander
$215.00
Importe total (MXN)
`;

const SANTANDER_TO_NULL_TEXT = `\
Banco Santander (México), S.A.
Transferencia enviada, en proceso de validación
Cuenta de origen CTA *8678 Supercuenta Cheques
Fecha y hora de operación 31/may/2026 - 20:41:29 h
Tarjeta de débito *4494 - null
$4,500.00
Importe total (MXN)
`;

const AMEX_TEXT = `\
American Express - Confirm Payment
Gracias por tu Pago. Has enviado un pago para tu La Tarjeta American
Express® Aeroméxico (-22009).
Cuenta Bancaria
SANTANDER - 6784
Importe del pago en Pesos
$6,602.43
Fecha
14 may, 2026
`;

// ---------------------------------------------------------------------------
// identifyBanks
// ---------------------------------------------------------------------------

describe("identifyBanks", () => {
  it("returns BBVA -> Banamex", () => {
    const [src, dst] = identifyBanks(BBVA_TEXT);
    expect(src).toBe("BBVA");
    expect(dst).toBe("Banamex");
  });

  it("returns Banamex -> Santander for interbank deposit", () => {
    const [src, dst] = identifyBanks(BANAMEX_INTERBANK_TEXT);
    expect(src).toBe("Banamex");
    expect(dst).toBe("Santander");
  });

  it("returns Banamex -> Costco for TDC payment", () => {
    const [src, dst] = identifyBanks(BANAMEX_TDC_TEXT);
    expect(src).toBe("Banamex");
    expect(dst).toBe("Costco");
  });

  it("returns Santander -> BBVA for TDC other", () => {
    const [src, dst] = identifyBanks(SANTANDER_TDC_OTHER_TEXT);
    expect(src).toBe("Santander");
    expect(dst).toBe("BBVA");
  });

  it("returns Santander -> Santander for own TDC", () => {
    const [src, dst] = identifyBanks(SANTANDER_TDC_OWN_TEXT);
    expect(src).toBe("Santander");
    expect(dst).toBe("Santander");
  });

  it("returns Santander -> MercadoPago for transfer", () => {
    const [src, dst] = identifyBanks(SANTANDER_TRANSFER_TEXT);
    expect(src).toBe("Santander");
    expect(dst).toBe("MercadoPago");
  });

  it("returns UNKNOWN for random text", () => {
    const [src, dst] = identifyBanks("Random text no bank markers");
    expect(src).toBe("UNKNOWN");
    expect(dst).toBe("UNKNOWN");
  });

  it("detects BBVA SPEI without BBVA brand", () => {
    const [src, dst] = identifyBanks(BBVA_SPEI_NO_BRAND_TEXT);
    expect(src).toBe("BBVA");
    expect(dst).toBe("Santander");
  });

  it("detects BBVA own TDC", () => {
    const [src, dst] = identifyBanks(BBVA_OWN_TDC_TEXT);
    expect(src).toBe("BBVA");
    expect(dst).toBe("BBVA");
  });

  it("detects BBVA debit card transfer as OTHER destination", () => {
    const text = `\
CAJINA MORALES CARLOS ERNESTO
A tarjeta de Débito
Cuenta de retiro: LIBRETONB
Cuenta destino: *****62118
Nombre del beneficiario: PEDRO CASTILLO BECERRA
Importe: $950.00
BBVA México, S.A., Institución de Banca Múltiple, Grupo Financiero BBVA México.
`;
    const [src, dst] = identifyBanks(text);
    expect(src).toBe("BBVA");
    expect(dst).toBe("OTHER");
  });

  it("detects Santander programmed TDC to BBVA", () => {
    const [src, dst] = identifyBanks(SANTANDER_PROGRAMMED_TEXT);
    expect(src).toBe("Santander");
    expect(dst).toBe("BBVA");
  });

  it("detects Santander -> Nu Mexico", () => {
    const [src, dst] = identifyBanks(SANTANDER_TO_NU_TEXT);
    expect(src).toBe("Santander");
    expect(dst).toBe("NuMexico");
  });

  it("detects Santander -> Santander for third-party transfer", () => {
    const [src, dst] = identifyBanks(SANTANDER_TO_SANTANDER_TEXT);
    expect(src).toBe("Santander");
    expect(dst).toBe("Santander");
  });

  it("detects Santander -> OTHER for null debit card", () => {
    const [src, dst] = identifyBanks(SANTANDER_TO_NULL_TEXT);
    expect(src).toBe("Santander");
    expect(dst).toBe("OTHER");
  });

  it("detects Amex from Santander", () => {
    const [src, dst] = identifyBanks(AMEX_TEXT);
    expect(src).toBe("Santander");
    expect(dst).toBe("Amex");
  });

  it("does not treat SANTANDER as source when only in Banco destino", () => {
    const text = "Banco destino:Santander\nSome other bank details";
    const [src, dst] = identifyBanks(text);
    expect(src).toBe("UNKNOWN");
    expect(dst).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// Per-bank parsers (unit-level)
// ---------------------------------------------------------------------------

describe("parseAmex", () => {
  it("returns null without markers", () => {
    expect(parseAmex("random", "RANDOM")).toBeNull();
  });

  it("returns Santander -> Amex with indicator", () => {
    const result = parseAmex(AMEX_TEXT, AMEX_TEXT.toUpperCase());
    expect(result).toEqual(["Santander", "Amex"]);
  });

  it("returns UNKNOWN -> Amex without source indicator", () => {
    const text = "American Express - Confirm Payment";
    const result = parseAmex(text, text.toUpperCase());
    expect(result).toEqual(["UNKNOWN", "Amex"]);
  });
});

describe("parseBbva", () => {
  it("returns null without markers", () => {
    expect(parseBbva("random", "RANDOM")).toBeNull();
  });

  it("matches via source markers and reads Banco destino", () => {
    const result = parseBbva(BBVA_TEXT, BBVA_TEXT.toUpperCase());
    expect(result).toEqual(["BBVA", "Banamex"]);
  });

  it("matches via alt markers", () => {
    const result = parseBbva(
      BBVA_SPEI_NO_BRAND_TEXT,
      BBVA_SPEI_NO_BRAND_TEXT.toUpperCase()
    );
    expect(result).toEqual(["BBVA", "Santander"]);
  });

  it("matches own TDC", () => {
    const result = parseBbva(BBVA_OWN_TDC_TEXT, BBVA_OWN_TDC_TEXT.toUpperCase());
    expect(result).toEqual(["BBVA", "BBVA"]);
  });

  it("matches debit card", () => {
    const text = `\
A tarjeta de Débito
Cuenta de retiro: LIBRETONB
Cuenta destino: *****62118
BBVA México, S.A.
`;
    const result = parseBbva(text, text.toUpperCase());
    expect(result).toEqual(["BBVA", "OTHER"]);
  });

  it("matches via fuzzy markers and logs warning", () => {
    const text = "BBV CUENT DESTINO TARJET CRÉDITO";
    const result = parseBbva(text, text.toUpperCase());
    expect(result).toEqual(["BBVA", "BBVA"]);
  });
});

describe("parseBanamex", () => {
  it("returns null without markers", () => {
    expect(parseBanamex("random", "RANDOM")).toBeNull();
  });

  it("detects interbank deposit to Santander", () => {
    const result = parseBanamex(
      BANAMEX_INTERBANK_TEXT,
      BANAMEX_INTERBANK_TEXT.toUpperCase()
    );
    expect(result).toEqual(["Banamex", "Santander"]);
  });

  it("detects TDC payment to Costco", () => {
    const result = parseBanamex(BANAMEX_TDC_TEXT, BANAMEX_TDC_TEXT.toUpperCase());
    expect(result).toEqual(["Banamex", "Costco"]);
  });

  it("uses dash split fallback when no bank listed", () => {
    const text =
      "Pago interbancario\nCuenta de retiro: MiCuenta Banamex\nCuenta de depósito: CARLOS FOO-FOO BANK-CLABE-";
    const result = parseBanamex(text, text.toUpperCase());
    expect(result).toEqual(["Banamex", "FooBank"]);
  });

  it("returns OTHER when deposit line has no known bank and no split", () => {
    const text =
      "Pago interbancario\nCuenta de retiro: MiCuenta Banamex\nCuenta de depósito: CARLOS SOMETHING";
    const result = parseBanamex(text, text.toUpperCase());
    expect(result).toEqual(["Banamex", "OTHER"]);
  });
});

describe("parseSantander", () => {
  it("returns null without BANCO SANTANDER", () => {
    expect(parseSantander("random", "RANDOM")).toBeNull();
  });

  it("detects programmed TDC", () => {
    const result = parseSantander(
      SANTANDER_PROGRAMMED_TEXT,
      SANTANDER_PROGRAMMED_TEXT.toUpperCase()
    );
    expect(result).toEqual(["Santander", "BBVA"]);
  });

  it("detects TDC other", () => {
    const result = parseSantander(
      SANTANDER_TDC_OTHER_TEXT,
      SANTANDER_TDC_OTHER_TEXT.toUpperCase()
    );
    expect(result).toEqual(["Santander", "BBVA"]);
  });

  it("detects own TDC", () => {
    const result = parseSantander(
      SANTANDER_TDC_OWN_TEXT,
      SANTANDER_TDC_OWN_TEXT.toUpperCase()
    );
    expect(result).toEqual(["Santander", "Santander"]);
  });

  it("detects transfer to MercadoPago", () => {
    const result = parseSantander(
      SANTANDER_TRANSFER_TEXT,
      SANTANDER_TRANSFER_TEXT.toUpperCase()
    );
    expect(result).toEqual(["Santander", "MercadoPago"]);
  });

  it("detects transfer to Nu Mexico", () => {
    const result = parseSantander(SANTANDER_TO_NU_TEXT, SANTANDER_TO_NU_TEXT.toUpperCase());
    expect(result).toEqual(["Santander", "NuMexico"]);
  });

  it("detects third-party Santander transfer", () => {
    const result = parseSantander(
      SANTANDER_TO_SANTANDER_TEXT,
      SANTANDER_TO_SANTANDER_TEXT.toUpperCase()
    );
    expect(result).toEqual(["Santander", "Santander"]);
  });

  it("detects null debit card as OTHER", () => {
    const result = parseSantander(
      SANTANDER_TO_NULL_TEXT,
      SANTANDER_TO_NULL_TEXT.toUpperCase()
    );
    expect(result).toEqual(["Santander", "OTHER"]);
  });
});

describe("parseGeneric", () => {
  it("returns null without generic markers", () => {
    expect(parseGeneric("random", "RANDOM")).toBeNull();
  });

  it("detects Banamex TDC payment", () => {
    const result = parseGeneric(BANAMEX_TDC_TEXT, BANAMEX_TDC_TEXT.toUpperCase());
    expect(result).toEqual(["Banamex", "Costco"]);
  });

  it("detects Banamex from name only", () => {
    const text = "BANAMEX\nRandom text";
    const result = parseGeneric(text, text.toUpperCase());
    expect(result).toEqual(["Banamex", "OTHER"]);
  });

  it("detects Santander when not a destination bank", () => {
    const text = "Banco Santander\nRandom text";
    const result = parseGeneric(text, text.toUpperCase());
    expect(result).toEqual(["Santander", "OTHER"]);
  });

  it("does not detect Santander when only Banco destino", () => {
    const text = "Banco destino:Santander\nSome other bank details";
    const result = parseGeneric(text, text.toUpperCase());
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractSantanderDest helpers
// ---------------------------------------------------------------------------

describe("extractSantanderDest", () => {
  it("extracts CLABE destination", () => {
    const text = "Número de cuenta CLABE *2072 - Mercado Pago W";
    const dest = extractSantanderDest(text, text.toUpperCase());
    expect(dest).toBe("MercadoPago");
  });

  it("strips trailing single letter from CLABE destination", () => {
    const text = "Número de cuenta CLABE *2072 - Nu Mexico W";
    const dest = extractSantanderDest(text, text.toUpperCase());
    expect(dest).toBe("NuMexico");
  });

  it("extracts TDC destination", () => {
    const text = "Número de tarjeta TDC *2663 - BBVA Bancomer";
    const dest = extractSantanderDest(text, text.toUpperCase());
    expect(dest).toBe("BBVA");
  });

  it("returns OTHER for TDC NULL", () => {
    const text = "Número de tarjeta TDC *2663 - null";
    const dest = extractSantanderDest(text, text.toUpperCase());
    expect(dest).toBe("OTHER");
  });

  it("returns OTHER for TDC NONE", () => {
    const text = "Número de tarjeta TDC *2663 - none";
    const dest = extractSantanderDest(text, text.toUpperCase());
    expect(dest).toBe("OTHER");
  });

  it("returns OTHER for TDC empty first word", () => {
    const text = "Número de tarjeta TDC *2663 -  ";
    const dest = extractSantanderDest(text, text.toUpperCase());
    expect(dest).toBe("OTHER");
  });

  it("extracts contact account destination", () => {
    const text = "Número de cuenta *2832 - Nu Mexico";
    const dest = extractSantanderDest(text, text.toUpperCase());
    expect(dest).toBe("NuMexico");
  });

  it("extracts cuenta destination", () => {
    const text = "Cuenta *5697 - Santander";
    const dest = extractSantanderDest(text, text.toUpperCase());
    expect(dest).toBe("Santander");
  });

  it("extracts debit card destination", () => {
    const text = "Tarjeta de débito *4494 - Nu Mexico";
    const dest = extractSantanderDest(text, text.toUpperCase());
    expect(dest).toBe("NuMexico");
  });

  it("returns OTHER for debit null", () => {
    const text = "Tarjeta de débito *4494 - null";
    const dest = extractSantanderDest(text, text.toUpperCase());
    expect(dest).toBe("OTHER");
  });

  it("returns null when no destination pattern matches", () => {
    expect(extractSantanderDest("random", "RANDOM")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PARSERS dispatch order
// ---------------------------------------------------------------------------

describe("PARSERS", () => {
  it("has the fixed order", () => {
    expect(PARSERS).toHaveLength(5);
    expect(PARSERS[0]).toBe(parseAmex);
    expect(PARSERS[1]).toBe(parseBbva);
    expect(PARSERS[2]).toBe(parseBanamex);
    expect(PARSERS[3]).toBe(parseSantander);
    expect(PARSERS[4]).toBe(parseGeneric);
  });
});

// ---------------------------------------------------------------------------
// extractInfo integration
// ---------------------------------------------------------------------------

describe("extractInfo", () => {
  it("extracts BBVA full receipt", () => {
    const info = extractInfo(BBVA_TEXT);
    expect(info.sourceBank).toBe("BBVA");
    expect(info.destBank).toBe("Banamex");
    expect(info.amount).toBe(128.0);
    expect(info.date).not.toBeNull();
    expect(info.date?.getFullYear()).toBe(2026);
    expect(info.isComplete()).toBe(true);
  });

  it("extracts Santander transfer receipt", () => {
    const info = extractInfo(SANTANDER_TRANSFER_TEXT);
    expect(info.sourceBank).toBe("Santander");
    expect(info.destBank).toBe("MercadoPago");
    expect(info.amount).toBe(207.78);
    expect(info.isComplete()).toBe(true);
  });

  it("cleans corrupted text before extraction", () => {
    const corruptText =
      "BBV\uffff\uffffM\u00e9xico, S.\uffff., " +
      "Instituci\u00f3n\ufffdde\ufffdBanca\ufffdM\u00faltiple, " +
      "Grupo\ufffdFinanciero\ufffdBBV\uffff\uffffM\u00e9xico.\n" +
      "IMPORTE \uffff $10,000.00\n" +
      "CUENT\uffff\uffffDESTINO \uffff 4772133048882663\n" +
      "Tarjeta\ufffdde\ufffdcr\u00e9dito\n" +
      "TIPO\ufffdDE\ufffdOPER\uffffCI\u00d3N \uffff TR\uffffSP\uffffSO\ufffdCUENT\ufffdS\ufffdPROPI\ufffdS\ufffd(TDC)\n" +
      "FECH\uffff\uffffDE\ufffdOPER\uffffCI\u00d3N \uffff 04/05/2026 \uffff3:34:48\ufffdPM";
    const info = extractInfo(corruptText);
    expect(info.sourceBank).toBe("BBVA");
    expect(info.destBank).toBe("BBVA");
    expect(info.amount).toBe(10000.0);
    expect(info.date).not.toBeNull();
    expect(info.date?.getUTCDate()).toBe(4);
    expect(info.isComplete()).toBe(true);
  });

  it("extracts BBVA SPEI without brand", () => {
    const info = extractInfo(BBVA_SPEI_NO_BRAND_TEXT);
    expect(info.sourceBank).toBe("BBVA");
    expect(info.destBank).toBe("Santander");
    expect(info.amount).toBe(14080.0);
    expect(info.date).not.toBeNull();
    expect(info.isComplete()).toBe(true);
  });

  it("extracts Amex full receipt", () => {
    const info = extractInfo(AMEX_TEXT);
    expect(info.sourceBank).toBe("Santander");
    expect(info.destBank).toBe("Amex");
    expect(info.amount).toBe(6602.43);
    expect(info.date).not.toBeNull();
    expect(info.isComplete()).toBe(true);
  });

  it("extracts Amex confirm payment layout", () => {
    const text = `\
American Express - Confirm Payment 13/07/26, 9:55 a.m.
Cuenta Bancaria SANTANDER - 6784
Importe del pago en $3,600.00
Pesos Otra cantidad en Pesos
Fecha 13 jul, 2026
`;
    const info = extractInfo(text);
    expect(info.sourceBank).toBe("Santander");
    expect(info.destBank).toBe("Amex");
    expect(info.amount).toBe(3600.0);
    expect(info.date).not.toBeNull();
    expect(info.isComplete()).toBe(true);
  });

  it("extracts whole-number amount Santander own TDC", () => {
    const text = `\
Banco Santander (México), S.A.
Pago de TDC propia
Fecha de operación 14/may/2026
$85
Importe total (MXN)
`;
    const info = extractInfo(text);
    expect(info.sourceBank).toBe("Santander");
    expect(info.destBank).toBe("Santander");
    expect(info.amount).toBe(85.0);
    expect(info.isComplete()).toBe(true);
  });

  it("extracts programmed TDC", () => {
    const info = extractInfo(SANTANDER_PROGRAMMED_TEXT);
    expect(info.sourceBank).toBe("Santander");
    expect(info.destBank).toBe("BBVA");
    expect(info.amount).toBe(10224.01);
    expect(info.isComplete()).toBe(true);
  });

  it("extracts Santander to Nu Mexico", () => {
    const info = extractInfo(SANTANDER_TO_NU_TEXT);
    expect(info.sourceBank).toBe("Santander");
    expect(info.destBank).toBe("NuMexico");
    expect(info.amount).toBe(500.0);
    expect(info.isComplete()).toBe(true);
  });

  it("extracts Santander third-party transfer", () => {
    const info = extractInfo(SANTANDER_TO_SANTANDER_TEXT);
    expect(info.sourceBank).toBe("Santander");
    expect(info.destBank).toBe("Santander");
    expect(info.amount).toBe(215.0);
    expect(info.isComplete()).toBe(true);
  });

  it("extracts amount after $0.00 cost placeholder", () => {
    const text = `\
Banco Santander (México), S.A.
Transferencia enviada
Número de cuenta CLABE *2473 - BBVA Mexico
$0.00 MXN
Costo de la operación + IVA
$600.00
Importe total (MXN)
`;
    const info = extractInfo(text);
    expect(info.amount).toBe(600.0);
    expect(info.destBank).toBe("BBVA");
  });

  it("extracts whole number after $0.00 cost placeholder", () => {
    const text = `\
Banco Santander (México), S.A.
Transferencia a otros bancos - SPEI
Número de cuenta *2473 - BBVA Mexico
$0.00 MXN
Costo de la operación + IVA
$500
Importe total (MXN)
`;
    const info = extractInfo(text);
    expect(info.amount).toBe(500.0);
  });

  it("extracts SAT recibo bancario", () => {
    const text = `\
Banco Santander (México), S.A.
Recibo Bancario de Pago de Contribuciones, Productos y Aprovechamientos Federales
Fecha y Hora de Pago: 14/05/2026 - 19:15 Hrs
$900
Importe Pagado:
`;
    const info = extractInfo(text);
    expect(info.sourceBank).toBe("Santander");
    expect(info.amount).toBe(900.0);
    expect(info.date).not.toBeNull();
    expect(info.isComplete()).toBe(true);
  });

  it("returns incomplete for empty text", () => {
    const info = extractInfo("");
    expect(info.date).toBeNull();
    expect(info.amount).toBeNull();
    expect(info.sourceBank).toBe("UNKNOWN");
    expect(info.destBank).toBe("UNKNOWN");
    expect(info.isComplete()).toBe(false);
  });
});
