import { describe, it, expect } from "vitest";
import { cleanText, cleanBankName, TransactionInfo } from "../models";

describe("cleanText", () => {
  it("strips U+FFFF", () => {
    expect(cleanText("BBV\uffff\uffffM\u00e9xico")).toBe("BBVM\u00e9xico");
  });

  it("strips U+FFFD", () => {
    expect(cleanText("test\ufffdhere")).toBe("testhere");
  });

  it("strips null bytes", () => {
    expect(cleanText("abc\x00def")).toBe("abcdef");
  });

  it("preserves normal text", () => {
    expect(cleanText("BBVA M\u00e9xico, S.A.")).toBe("BBVA M\u00e9xico, S.A.");
  });
});

describe("cleanBankName", () => {
  it("keeps acronyms upper-case", () => {
    expect(cleanBankName("BBVA")).toBe("BBVA");
    expect(cleanBankName("HSBC")).toBe("HSBC");
    expect(cleanBankName("TDC")).toBe("TDC");
  });

  it("converts upper-case names to title case", () => {
    expect(cleanBankName("BANAMEX")).toBe("Banamex");
    expect(cleanBankName("SANTANDER")).toBe("Santander");
  });

  it("converts lower-case names to title case", () => {
    expect(cleanBankName("bancomer")).toBe("Bancomer");
  });

  it("preserves mixed case and removes spaces", () => {
    expect(cleanBankName("Mercado Pago")).toBe("MercadoPago");
    expect(cleanBankName("Banorte")).toBe("Banorte");
  });

  it("resolves bank aliases", () => {
    expect(cleanBankName("BBVA Mexico")).toBe("BBVA");
    expect(cleanBankName("BBVA MEXICO")).toBe("BBVA");
    expect(cleanBankName("BBVA Bancomer")).toBe("BBVA");
    expect(cleanBankName("Mercado Pago W")).toBe("MercadoPago");
  });

  it("resolves Nu Mexico aliases", () => {
    expect(cleanBankName("Nu Mexico")).toBe("NuMexico");
    expect(cleanBankName("NU MEXICO")).toBe("NuMexico");
  });

  it("resolves American Express alias", () => {
    expect(cleanBankName("American Express")).toBe("Amex");
  });
});

describe("TransactionInfo", () => {
  it("is complete when date, amount and source bank are present", () => {
    const info = new TransactionInfo(new Date(2026, 4, 10), "Santander", "BBVA", 128.0);
    expect(info.isComplete()).toBe(true);
  });

  it("is incomplete when date is missing", () => {
    const info = new TransactionInfo(null, "Santander", "BBVA", 128.0);
    expect(info.isComplete()).toBe(false);
  });

  it("is incomplete when amount is missing", () => {
    const info = new TransactionInfo(new Date(2026, 4, 10), "Santander", "BBVA", null);
    expect(info.isComplete()).toBe(false);
  });

  it("is incomplete when source bank is UNKNOWN", () => {
    const info = new TransactionInfo(new Date(2026, 4, 10), "UNKNOWN", "BBVA", 128.0);
    expect(info.isComplete()).toBe(false);
  });
});
