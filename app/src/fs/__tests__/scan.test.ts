import { describe, it, expect } from "vitest";
import { scanInputFolder } from "../scan";
import { fakeDir, fakeFile } from "./fakes";

describe("scanInputFolder", () => {
  it("returns only top-level .pdf files (case-insensitive) and skips directories", async () => {
    const dir = fakeDir([
      fakeFile("statement.pdf", "pdf-1"),
      fakeFile("notes.txt", "text"),
      fakeFile("INVOICE.PDF", "pdf-2"),
      { kind: "directory", name: "processed", entries: [fakeFile("nested.pdf", "pdf-3")] },
    ]);

    const entries = await scanInputFolder(dir);
    const names = entries.map((e) => e.name).sort();

    expect(names).toEqual(["INVOICE.PDF", "statement.pdf"]);

    // Sorted scan order (matching Python's sorted(iterdir())) must not depend
    // on directory iteration order.
    expect(entries.map((e) => e.name)).toEqual(["INVOICE.PDF", "statement.pdf"]);

    const byName = Object.fromEntries(
      await Promise.all(entries.map(async (e) => [e.name, await e.file.text()]))
    );
    expect(byName["statement.pdf"]).toBe("pdf-1");
    expect(byName["INVOICE.PDF"]).toBe("pdf-2");
  });

  it("sorts by code point, matching Python's str comparison", async () => {
    // U+FFFD (65533) sorts before U+10000 (65536) in code-point order, but
    // after it in UTF-16 code-unit order — the pair that makes a naive
    // string comparison diverge from sorted(iterdir()).
    const dir = fakeDir([
      fakeFile("receipt\u{10000}.pdf", "astral"),
      fakeFile("receipt\uFFFD.pdf", "replacement"),
    ]);

    const entries = await scanInputFolder(dir);

    expect(entries.map((e) => e.name)).toEqual([
      "receipt\uFFFD.pdf",
      "receipt\u{10000}.pdf",
    ]);
  });
});
