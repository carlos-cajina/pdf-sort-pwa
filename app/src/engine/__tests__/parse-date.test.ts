import { describe, it, expect } from "vitest";
import { parseDate } from "../parsers";

describe("parseDate", () => {
  it("dd mon yyyy english", () => {
    const d = parseDate("30 Apr 2026 04:31:50");
    expect(d?.getUTCDate()).toBe(30);
    expect(d?.getUTCMonth()).toBe(3); // April
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  it("dd mon yyyy spanish", () => {
    const d = parseDate("10/may/2026 - 06:26:56 h");
    expect(d?.getUTCDate()).toBe(10);
    expect(d?.getUTCMonth()).toBe(4); // May
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  it("Fecha de operacion santander", () => {
    const d = parseDate("Fecha de operación 30/abr/2026");
    expect(d?.getUTCDate()).toBe(30);
    expect(d?.getUTCMonth()).toBe(3); // April
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  it("Fecha y hora de operacion santander", () => {
    const d = parseDate("Fecha y hora de operación 30/abr/2026 - 04:35:52 h");
    expect(d?.getUTCDate()).toBe(30);
    expect(d?.getUTCMonth()).toBe(3); // April
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  it("Fecha y hora de aplicacion santander", () => {
    const d = parseDate("Fecha y hora de aplicación 27/abr/2026 - 06:10:22 h");
    expect(d?.getUTCDate()).toBe(27);
    expect(d?.getUTCMonth()).toBe(3); // April
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  it("banamex spanish month", () => {
    const d = parseDate("30 Abr 2026");
    expect(d?.getUTCDate()).toBe(30);
    expect(d?.getUTCMonth()).toBe(3); // April
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  it("Fecha de aplicacion banamex", () => {
    const d = parseDate("Fecha de aplicación: 10 May 2026");
    expect(d?.getUTCDate()).toBe(10);
    expect(d?.getUTCMonth()).toBe(4); // May
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  it("numeric dd mm yyyy", () => {
    const d = parseDate("Fecha de operación: 10/05/2026");
    expect(d?.getUTCDate()).toBe(10);
    expect(d?.getUTCMonth()).toBe(4); // May
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  it("none on no match", () => {
    expect(parseDate("random text without dates")).toBeNull();
  });

  it("Fecha de operacion sept", () => {
    // Santander uses 4-letter 'sept' for September.
    const d = parseDate("Fecha de operación 07/sept/2026");
    expect(d?.getUTCDate()).toBe(7);
    expect(d?.getUTCMonth()).toBe(8); // September
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  it("corrupted numeric date glued time", () => {
    // U+FFFF stripped from '2026\uFFFF8:25:57' glues year to time.
    const d = parseDate("FECHADEOPERACI\u00d3N 29/06/20268:25:57PM");
    expect(d?.getUTCDate()).toBe(29);
    expect(d?.getUTCMonth()).toBe(5); // June
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  // Ph1-1B: hyphenated dates
  it("hyphenated Fecha de operacion", () => {
    // 22-04-2026 (BBVA SPEI receipt)
    const d = parseDate("Fecha de operación:22-04-2026");
    expect(d?.getUTCDate()).toBe(22);
    expect(d?.getUTCMonth()).toBe(3); // April
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  it("hyphenated Fecha de aplicacion", () => {
    const d = parseDate("Fecha de aplicación:22-04-2026");
    expect(d?.getUTCDate()).toBe(22);
    expect(d?.getUTCMonth()).toBe(3); // April
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  it("hyphenated bare", () => {
    // Bare DD-MM-YYYY in text
    const d = parseDate("Some text 31-05-2026 more text");
    expect(d?.getUTCDate()).toBe(31);
    expect(d?.getUTCMonth()).toBe(4); // May
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  // Ph2-2A: AmEx date format
  it("amex Fecha multiline", () => {
    const d = parseDate("Fecha\n14 may, 2026");
    expect(d?.getUTCDate()).toBe(14);
    expect(d?.getUTCMonth()).toBe(4); // May
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  it("two-digit year maps 00-49 to 2000s", () => {
    const d = parseDate("Fecha y hora de operación 27/abr/26");
    expect(d?.getUTCFullYear()).toBe(2026);
  });

  it("two-digit year maps 50-99 to 1900s", () => {
    const d = parseDate("Fecha y hora de operación 27/abr/99");
    expect(d?.getUTCFullYear()).toBe(1999);
  });
});
