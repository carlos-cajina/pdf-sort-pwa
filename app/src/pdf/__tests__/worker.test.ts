import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getDocument, GlobalWorkerOptions } = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {} as { workerSrc?: string },
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument,
  GlobalWorkerOptions,
}));

vi.mock("pdfjs-dist/legacy/build/pdf.worker.mjs?worker&url", () => ({
  default: "worker-url.js",
}));

function mockDoc(label: string) {
  return {
    numPages: 1,
    getPage: () =>
      Promise.resolve({
        getTextContent: () =>
          Promise.resolve({
            items: [
              { str: label, transform: [0, 0, 0, 0, 0, 100], width: 10 },
            ],
          }),
      }),
  };
}

function loadingTask(label: string) {
  return {
    promise: Promise.resolve(mockDoc(label)),
    destroy: vi.fn(() => Promise.resolve()),
  };
}

beforeEach(() => {
  vi.resetModules();
  getDocument.mockReset();
  delete GlobalWorkerOptions.workerSrc;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("pdf.js worker lifecycle", () => {
  it("latches one setup and configures workerSrc before any getDocument", async () => {
    vi.stubEnv("MODE", "development");
    vi.stubGlobal("Worker", class {});
    vi.stubGlobal("document", { baseURI: "https://example.test/" });

    // Record the order of the setup write and every getDocument call, and
    // count setup writes so a per-caller (unlatched) init would be visible.
    const order: string[] = [];
    let workerSrc: string | undefined;
    Object.defineProperty(GlobalWorkerOptions, "workerSrc", {
      configurable: true,
      get: () => workerSrc,
      set: (value: string) => {
        workerSrc = value;
        order.push("workerSrc");
      },
    });

    getDocument.mockImplementation(() => {
      order.push(`getDocument:${workerSrc}`);
      return loadingTask(`doc-${getDocument.mock.calls.length}`);
    });

    const { extractPdfText } = await import("../text");
    const [first, second] = await Promise.all([
      extractPdfText(new ArrayBuffer(0)),
      extractPdfText(new ArrayBuffer(0)),
    ]);

    // Both concurrent first callers resolved, each with its own document.
    expect(first).toBe("doc-1");
    expect(second).toBe("doc-2");

    // Setup ran exactly once, strictly before either getDocument call, and
    // both callers saw the configured worker URL.
    expect(order).toEqual([
      "workerSrc",
      "getDocument:worker-url.js",
      "getDocument:worker-url.js",
    ]);
  });

  it("keeps the Node/vitest path in plain data mode with no worker configured", async () => {
    vi.stubEnv("MODE", "test");
    getDocument.mockImplementation(() => loadingTask("node"));

    const { extractPdfText } = await import("../text");

    expect(await extractPdfText(new ArrayBuffer(0))).toBe("node");
    expect(getDocument).toHaveBeenCalledWith({ data: expect.any(ArrayBuffer) });
    expect(GlobalWorkerOptions.workerSrc).toBeUndefined();
  });
});
