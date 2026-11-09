import { describe, it, expect } from "vitest";
import { TransactionInfo } from "../models";
import {
  fmtAmount,
  fmtMonthYear,
  buildFilename,
  deduplicate,
  sanitizeFilename,
  type EnginePlanItem,
} from "../rename";

describe("fmtAmount", () => {
  it("formats small amounts", () => {
    expect(fmtAmount(128.0)).toBe("128.00");
  });

  it("formats thousands with commas", () => {
    expect(fmtAmount(52713.61)).toBe("52,713.61");
  });

  it("formats zero", () => {
    expect(fmtAmount(0.0)).toBe("0.00");
  });

  it("matches Python format(x, ',.2f') on binary midpoints", () => {
    expect(fmtAmount(0.125)).toBe("0.12"); // exact binary midpoint → half-even down
    expect(fmtAmount(1.005)).toBe("1.00"); // binary value is 1.00499…
    expect(fmtAmount(2.675)).toBe("2.67"); // binary value is 2.67499…
    expect(fmtAmount(52713.61)).toBe("52,713.61");
    expect(fmtAmount(128)).toBe("128.00");
  });
});

describe("fmtMonthYear", () => {
  it("formats May 2026", () => {
    const d = new Date(Date.UTC(2026, 4, 10));
    expect(fmtMonthYear(d)).toBe("May2026");
  });

  it("formats April 2026", () => {
    const d = new Date(Date.UTC(2026, 3, 30));
    expect(fmtMonthYear(d)).toBe("Apr2026");
  });
});

describe("buildFilename", () => {
  it("builds filename for complete info", () => {
    const info = new TransactionInfo(
      new Date(Date.UTC(2026, 4, 10)),
      "BBVA",
      "Banamex",
      128.0
    );
    expect(buildFilename(info)).toBe("transfBBVA_to_Banamex_x128.00_May2026.pdf");
  });

  it("appends suffix when provided", () => {
    const info = new TransactionInfo(
      new Date(Date.UTC(2026, 4, 10)),
      "BBVA",
      "Banamex",
      128.0
    );
    expect(buildFilename(info, "2")).toBe(
      "transfBBVA_to_Banamex_x128.00_May2026_2.pdf"
    );
  });

  it("returns null for incomplete info", () => {
    const info = new TransactionInfo(null, "UNKNOWN", "OTHER", null);
    expect(buildFilename(info)).toBeNull();
  });

  it("does not duplicate .pdf extension", () => {
    const info = new TransactionInfo(
      new Date(Date.UTC(2026, 3, 30)),
      "Santander",
      "BBVA",
      3000.0
    );
    const result = buildFilename(info);
    expect(result).toMatch(/\.pdf$/);
    expect(result).not.toMatch(/\.pdf\.pdf$/);
  });
});

describe("deduplicate", () => {
  it("keeps names unchanged when there are no collisions", () => {
    const info1 = new TransactionInfo(
      new Date(Date.UTC(2026, 3, 30)),
      "Santander",
      "BBVA",
      3000.0
    );
    const info2 = new TransactionInfo(
      new Date(Date.UTC(2026, 4, 10)),
      "BBVA",
      "Banamex",
      128.0
    );
    const plan: EnginePlanItem[] = [
      { original: "a.pdf", info: info1 },
      { original: "b.pdf", info: info2 },
    ];
    const result = deduplicate(plan);
    expect(result[0].newName).toBe("transfSantander_to_BBVA_x3,000.00_Apr2026.pdf");
    expect(result[1].newName).toBe("transfBBVA_to_Banamex_x128.00_May2026.pdf");
  });

  it("adds _2, _3 suffixes for collisions", () => {
    const info1 = new TransactionInfo(
      new Date(Date.UTC(2026, 3, 30)),
      "Santander",
      "MercadoPago",
      300.0
    );
    const info2 = new TransactionInfo(
      new Date(Date.UTC(2026, 3, 30)),
      "Santander",
      "MercadoPago",
      300.0
    );
    const plan: EnginePlanItem[] = [
      { original: "a.pdf", info: info1 },
      { original: "b.pdf", info: info2 },
    ];
    const result = deduplicate(plan);
    expect(result[0].newName).toBe(
      "transfSantander_to_MercadoPago_x300.00_Apr2026.pdf"
    );
    expect(result[1].newName).toBe(
      "transfSantander_to_MercadoPago_x300.00_Apr2026_2.pdf"
    );
  });

  it("sets newName to null for incomplete records", () => {
    const info = new TransactionInfo(null, "UNKNOWN", "OTHER", null);
    const plan: EnginePlanItem[] = [{ original: "bad.pdf", info }];
    const result = deduplicate(plan);
    expect(result[0].newName).toBeNull();
  });
});

describe("sanitizeFilename", () => {
  it("replaces unsafe characters and whitespace with underscores", () => {
    expect(sanitizeFilename('bad<>:"/\\|?* name.pdf')).toBe(
      "bad__________name.pdf"
    );
  });
});
