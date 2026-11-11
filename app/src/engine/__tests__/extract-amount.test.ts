import { describe, it, expect } from "vitest";
import { extractAmount } from "../parsers";

describe("extractAmount", () => {
  it("importe with dollar", () => {
    const text = "Importe: $128.00\nComisión por Transferencia: $5.00 + IVA";
    expect(extractAmount(text)).toBe(128.0);
  });

  it("importe with commas", () => {
    const text = "Importe: $ 52,713.61";
    expect(extractAmount(text)).toBe(52713.61);
  });

  it("importe total mxn", () => {
    const text = "$3,000.00\nImporte total (MXN)";
    expect(extractAmount(text)).toBe(3000.0);
  });

  it("standalone dollar", () => {
    const text = "Importe total (MXN)\n$147.45";
    expect(extractAmount(text)).toBe(147.45);
  });

  it("commission line excluded", () => {
    const text = "Comisión por Transferencia - envío; $5.00 + IVA";
    expect(extractAmount(text)).toBeNull();

    const text2 = "Importe: $128.00\nComisión por Transferencia $5.00 + IVA";
    expect(extractAmount(text2)).toBe(128.0);
  });

  it("costo line excluded", () => {
    const text = "Costo de la operación + IVA $0.00";
    expect(extractAmount(text)).toBeNull();

    const text2 =
      "Importe total (MXN)\n$300.00\nCosto de la operación + IVA $0.00";
    expect(extractAmount(text2)).toBe(300.0);
  });

  it("monto pattern", () => {
    const text = "Monto\n$3,500.00\nMXN";
    expect(extractAmount(text)).toBe(3500.0);
  });

  it("whole number importe total mxn", () => {
    const text = "Importe total (MXN)\n$85";
    expect(extractAmount(text)).toBe(85.0);
  });

  it("whole number importe pagado", () => {
    const text = "Importe Pagado:\n$900";
    expect(extractAmount(text)).toBe(900.0);
  });

  it("whole number standalone dollar", () => {
    const text = "Some text\n$85\nMore text";
    expect(extractAmount(text)).toBe(85.0);
  });

  it("importe a pagar", () => {
    const text = "Importe a pagar:$ 14,080.00 MN";
    expect(extractAmount(text)).toBe(14080.0);
  });

  it("importe del pago en pesos", () => {
    const text = "Importe del pago en Pesos\n$6,602.43";
    expect(extractAmount(text)).toBe(6602.43);
  });

  it("importe del pago en same line", () => {
    const text = "Importe del pago en $3,600.00\nPesos Otra cantidad en Pesos";
    expect(extractAmount(text)).toBe(3600.0);
  });

  it("importe pagado multiline with decimals", () => {
    const text = "Importe Pagado:\n$10,224.01";
    expect(extractAmount(text)).toBe(10224.01);
  });
});
