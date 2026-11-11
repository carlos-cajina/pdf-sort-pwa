/// <reference types="vite/client" />

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  TextItem as PdfJsTextItem,
  TextMarkedContent,
} from "pdfjs-dist/types/src/display/api";
/**
 * Configure pdf.js's worker in the browser, lazily on first extraction.
 *
 * The setup is latched as a promise: concurrent first extractions all await
 * the same settled init, so none can call getDocument before the worker URL
 * is configured. In the browser we set `workerSrc` to the bundled worker
 * asset; pdf.js then gives every getDocument call its own PDFWorker, which
 * makes a per-document `loadingTask.destroy()` safe (no shared workerPort
 * that a sibling could tear down — mozilla/pdf.js#16777).
 *
 * The worker import is dynamic so plain Node (parity harness via tsx, no
 * Worker global) never evaluates the specifier, while Vite still emits the
 * worker asset. Guarded so vitest (where Worker is unavailable and the
 * module is mocked) never evaluates it either.
 */
let workerSetup: Promise<void> | null = null;

function ensureWorker(): Promise<void> {
  workerSetup ??= setupWorker().catch((error: unknown) => {
    // A transient setup failure must not poison the latch for the whole
    // page: clear it so the next extraction can retry setup.
    workerSetup = null;
    throw error;
  });
  return workerSetup;
}

async function setupWorker(): Promise<void> {
  if (typeof Worker === "undefined" || import.meta.env?.MODE === "test") {
    return;
  }
  // Per-document destroy() is only safe while pdf.js allocates a fresh
  // PDFWorker per getDocument — which requires workerPort to stay unset so
  // only workerSrc is configured (mozilla/pdf.js#16777). Assert the
  // invariant so a future shared-workerPort optimization fails loudly here
  // instead of tearing down sibling extractions.
  const workerPort = pdfjs.GlobalWorkerOptions.workerPort;
  if (workerPort !== null && workerPort !== undefined) {
    throw new Error(
      "pdf.js workerPort is set; per-document destroy() would kill the shared worker"
    );
  }
  const { default: workerSrc } = await import(
    "pdfjs-dist/legacy/build/pdf.worker.mjs?worker&url"
  );
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
}

/** Normalised pdf.js text item used by the clustering algorithm. */
export type TextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height?: number;
};

const X_TOLERANCE = 3;
const Y_TOLERANCE = 3;
const ASCENT = 0.75;

/**
 * Reconstruct a pdfplumber-style text representation from geometric text items.
 *
 * Algorithm (fixed by the plan):
 * - Estimate each glyph's top as y + ASCENT * height (raw y when height is absent).
 * - Sort by descending top, then ascending x.
 * - Walk items; start a new line whenever prev.top - item.top > y_tolerance.
 * - Sort each line by x, then insert a space when
 *   x - (prev.x + prev.width) > x_tolerance; otherwise concatenate.
 * - Skip items whose string is empty or whitespace-only.
 */
export function itemsToText(items: TextItem[]): string {
  const sorted = items
    .filter((item) => item.str.trim() !== "")
    .map((item) => ({
      ...item,
      top: item.y + ASCENT * (item.height ?? 0),
    }))
    .sort((a, b) => (a.top === b.top ? a.x - b.x : b.top - a.top));

  const lines: string[] = [];
  let lineItems: (TextItem & { top: number })[] = [];

  for (const item of sorted) {
    if (lineItems.length === 0) {
      lineItems.push(item);
      continue;
    }

    const prev = lineItems[lineItems.length - 1];
    if (prev.top - item.top > Y_TOLERANCE) {
      lines.push(buildLine(lineItems));
      lineItems = [item];
    } else {
      lineItems.push(item);
    }
  }

  if (lineItems.length > 0) {
    lines.push(buildLine(lineItems));
  }

  return lines.join("\n");
}

function buildLine(lineItems: TextItem[]): string {
  if (lineItems.length === 0) {
    return "";
  }
  const sorted = [...lineItems].sort((a, b) => a.x - b.x);
  let line = sorted[0].str;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const gap = curr.x - (prev.x + prev.width);
    line += gap > X_TOLERANCE ? ` ${curr.str}` : curr.str;
  }
  return line;
}

function isPdfTextItem(
  item: PdfJsTextItem | TextMarkedContent
): item is PdfJsTextItem {
  return (
    "str" in item &&
    typeof item.str === "string" &&
    "transform" in item &&
    Array.isArray(item.transform) &&
    item.transform.length >= 6 &&
    typeof item.transform[4] === "number" &&
    typeof item.transform[5] === "number" &&
    "width" in item &&
    typeof item.width === "number"
  );
}

/**
 * Extract text from a PDF using pdf.js, returning one pdfplumber-like string.
 *
 * Rejections from getDocument (encrypted/corrupt PDFs) are allowed to propagate.
 */
export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  await ensureWorker();
  const mode = import.meta.env?.MODE;
  // The plain `{ data }` path serves tests and non-browser Node (no Worker,
  // no document); every other case is the browser and needs the standard
  // fonts that ship with the app.
  const loadingTask = pdfjs.getDocument(
    mode === undefined || mode === "test" || typeof Worker === "undefined"
      ? { data }
      : {
          data,
          standardFontDataUrl: new URL(
            "standard_fonts/",
            document.baseURI
          ).toString(),
        }
  );
  const pageTexts: string[] = [];

  try {
    const doc = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const textItems: TextItem[] = content.items
        .filter(isPdfTextItem)
        .filter((item) => item.str !== "")
        .map((item) => ({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height,
        }));
      pageTexts.push(itemsToText(textItems));
    }
  } finally {
    await loadingTask.destroy().catch(() => {});
  }

  return pageTexts.join("\n");
}
