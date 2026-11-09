/// <reference types="vite/client" />

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  TextItem as PdfJsTextItem,
  TextMarkedContent,
} from "pdfjs-dist/types/src/display/api";
import PdfWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs?worker";

/**
 * Wire pdf.js to its worker in the browser. Guarded so vitest (where Worker is
 * unavailable and the module is mocked) never tries to instantiate it.
 */
if (typeof Worker !== "undefined" && import.meta.env.MODE !== "test") {
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
}

/** Normalised pdf.js text item used by the clustering algorithm. */
export type TextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
};

const X_TOLERANCE = 3;
const Y_TOLERANCE = 3;

/**
 * Reconstruct a pdfplumber-style text representation from geometric text items.
 *
 * Algorithm (fixed by the plan):
 * - Sort by descending y, then ascending x.
 * - Walk items; start a new line whenever prevY - item.y > y_tolerance.
 * - Within a line, insert a space when x - (prev.x + prev.width) > x_tolerance,
 *   otherwise concatenate.
 * - Skip items whose string is empty.
 */
export function itemsToText(items: TextItem[]): string {
  const sorted = items
    .filter((item) => item.str !== "")
    .sort((a, b) => (a.y === b.y ? a.x - b.x : b.y - a.y));

  const lines: string[] = [];
  let lineItems: TextItem[] = [];

  for (const item of sorted) {
    if (lineItems.length === 0) {
      lineItems.push(item);
      continue;
    }

    const prev = lineItems[lineItems.length - 1];
    if (prev.y - item.y > Y_TOLERANCE) {
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
  let line = lineItems[0].str;
  for (let i = 1; i < lineItems.length; i++) {
    const prev = lineItems[i - 1];
    const curr = lineItems[i];
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
  const doc = await pdfjs.getDocument({ data }).promise;
  const pageTexts: string[] = [];

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
      }));
    pageTexts.push(itemsToText(textItems));
  }

  return pageTexts.join("\n");
}
