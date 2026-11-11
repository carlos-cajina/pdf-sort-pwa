import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TextItem } from "../text";

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument,
  GlobalWorkerOptions: {},
}));

vi.mock("pdfjs-dist/legacy/build/pdf.worker.mjs?worker&url", () => ({
  default: "worker-url.js",
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

  it("keeps items on the same line at the exact y tolerance boundary (dy === 3)", () => {
    const items: TextItem[] = [
      { str: "a", x: 0, y: 100, width: 10 },
      { str: "b", x: 12, y: 97, width: 10 }, // dy 3 → same line
    ];
    expect(itemsToText(items)).toBe("ab");
  });

  it("clusters mixed-size glyphs by glyph top rather than baseline", () => {
    const items: TextItem[] = [
      { str: "Importe Pagado:", x: 100, y: 66.06, width: 80, height: 16 },
      { str: "$2,400", x: 0, y: 66.34, width: 50, height: 24 },
    ];
    expect(itemsToText(items)).toBe("$2,400\nImporte Pagado:");
  });

  it("sorts items by x within a glyph-top cluster", () => {
    const items: TextItem[] = [
      { str: "hello", x: 0, y: 100, width: 45, height: 8 },
      { str: "world", x: 50, y: 100.5, width: 30, height: 8 },
    ];
    expect(itemsToText(items)).toBe("hello world");
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

  it("skips empty and whitespace-only items", () => {
    const items: TextItem[] = [
      { str: "hello", x: 0, y: 100, width: 30 },
      { str: "", x: 32, y: 100, width: 2 },
      { str: " ", x: 35, y: 100, width: 10, height: 0 },
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
    const loadingTask = {
      promise: Promise.resolve(mockDoc),
      destroy: vi.fn(() => Promise.resolve()),
    };
    getDocument.mockReturnValue(loadingTask);

    const result = await extractPdfText(new ArrayBuffer(0));
    expect(result).toBe("Page1\nPage2");
    expect(loadingTask.destroy).toHaveBeenCalledOnce();
  });

  it("uses pdf.js item heights when clustering mixed-size glyphs", async () => {
    const mockDoc = {
      numPages: 1,
      getPage: vi.fn(() =>
        Promise.resolve({
          getTextContent: () =>
            Promise.resolve({
              items: [
                {
                  str: "Importe Pagado:",
                  transform: [0, 0, 0, 0, 100, 66.06],
                  width: 80,
                  height: 16,
                },
                {
                  str: "$2,400",
                  transform: [0, 0, 0, 0, 0, 66.34],
                  width: 50,
                  height: 24,
                },
              ],
            }),
        })
      ),
    };
    const loadingTask = {
      promise: Promise.resolve(mockDoc),
      destroy: vi.fn(() => Promise.resolve()),
    };
    getDocument.mockReturnValue(loadingTask);

    expect(await extractPdfText(new ArrayBuffer(0))).toBe(
      "$2,400\nImporte Pagado:"
    );
  });

  it("supports sequential extractions, tearing down each per-document task", async () => {
    const createMockDoc = (label: string) => ({
      numPages: 1,
      getPage: vi.fn(() =>
        Promise.resolve({
          getTextContent: () =>
            Promise.resolve({
              items: [
                {
                  str: label,
                  transform: [0, 0, 0, 0, 0, 100],
                  width: 40,
                },
              ],
            }),
        })
      ),
    });

    const firstTask = {
      promise: Promise.resolve(createMockDoc("first")),
      destroy: vi.fn(() => Promise.resolve()),
    };
    const secondTask = {
      promise: Promise.resolve(createMockDoc("second")),
      destroy: vi.fn(() => Promise.resolve()),
    };

    getDocument
      .mockReturnValueOnce(firstTask)
      .mockReturnValueOnce(secondTask);

    expect(await extractPdfText(new ArrayBuffer(0))).toBe("first");
    expect(await extractPdfText(new ArrayBuffer(0))).toBe("second");
    expect(firstTask.destroy).toHaveBeenCalledOnce();
    expect(secondTask.destroy).toHaveBeenCalledOnce();
  });

  it("lets getDocument rejections propagate and still tears down the loading task", async () => {
    const loadingTask = {
      promise: Promise.reject(new Error("bad pdf")),
      destroy: vi.fn(() => Promise.resolve()),
    };
    getDocument.mockReturnValue(loadingTask);

    await expect(extractPdfText(new ArrayBuffer(0))).rejects.toThrow("bad pdf");
    expect(loadingTask.destroy).toHaveBeenCalledOnce();
  });
});
