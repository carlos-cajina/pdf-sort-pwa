import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TextItem } from "../text";

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument,
  GlobalWorkerOptions: {},
}));

vi.mock("pdfjs-dist/legacy/build/pdf.worker.mjs?worker", () => ({
  default: class MockWorker {},
}));

import { itemsToText, extractPdfText } from "../text";

describe("itemsToText", () => {
  it("inserts a space when the x-gap exceeds tolerance", () => {
    const items: TextItem[] = [
      { str: "Importe", x: 0, y: 100, width: 40 },
      { str: "total", x: 50, y: 100, width: 30 }, // gap 10 > 3 → space
      { str: "(MXN)", x: 83, y: 100, width: 30 }, // gap 3 → no space
    ];
    expect(itemsToText(items)).toBe("Importe total(MXN)");
  });

  it("sorts same-line items by x and concatenates when the gap is within tolerance", () => {
    const items: TextItem[] = [
      { str: "world", x: 50, y: 100, width: 30 },
      { str: "hello", x: 0, y: 100, width: 45 }, // ends at 45, gap 5 > 3 → space
    ];
    expect(itemsToText(items)).toBe("hello world");
  });

  it("merges y-clusters within tolerance into one line", () => {
    const items: TextItem[] = [
      { str: "a", x: 0, y: 100, width: 10 },
      { str: "b", x: 12, y: 98, width: 10 }, // dy 2 ≤ 3 → same line, dx gap 2 ≤ 3
    ];
    expect(itemsToText(items)).toBe("ab");
  });

  it("starts a new line when the y-gap exceeds tolerance", () => {
    const items: TextItem[] = [
      { str: "top", x: 0, y: 100, width: 20 },
      { str: "bottom", x: 0, y: 90, width: 40 }, // dy 10 > 3 → new line
    ];
    expect(itemsToText(items)).toBe("top\nbottom");
  });

  it("orders clusters top-to-bottom (largest y first)", () => {
    const items: TextItem[] = [
      { str: "lower", x: 0, y: 50, width: 30 },
      { str: "upper", x: 0, y: 100, width: 30 },
    ];
    expect(itemsToText(items)).toBe("upper\nlower");
  });

  it("returns an empty string for empty input", () => {
    expect(itemsToText([])).toBe("");
  });

  it("skips items with empty strings", () => {
    const items: TextItem[] = [
      { str: "hello", x: 0, y: 100, width: 30 },
      { str: "", x: 35, y: 100, width: 10 },
      { str: "world", x: 50, y: 100, width: 30 },
    ];
    expect(itemsToText(items)).toBe("hello world");
  });
});

describe("extractPdfText", () => {
  beforeEach(() => {
    getDocument.mockReset();
  });

  it("joins text from every page with newline", async () => {
    const mockDoc = {
      numPages: 2,
      getPage: vi.fn((pageNumber: number) =>
        Promise.resolve({
          getTextContent: () =>
            Promise.resolve({
              items: [
                {
                  str: `Page${pageNumber}`,
                  transform: [0, 0, 0, 0, 10 * pageNumber, 100],
                  width: 40,
                },
              ],
            }),
        })
      ),
    };
    getDocument.mockReturnValue({ promise: Promise.resolve(mockDoc) });

    const result = await extractPdfText(new ArrayBuffer(0));
    expect(result).toBe("Page1\nPage2");
  });

  it("lets getDocument rejections propagate", async () => {
    getDocument.mockReturnValue({
      promise: Promise.reject(new Error("bad pdf")),
    });

    await expect(extractPdfText(new ArrayBuffer(0))).rejects.toThrow("bad pdf");
  });
});
