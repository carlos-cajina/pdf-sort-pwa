import type { TransactionInfo } from "./engine/models";
import { extractInfo } from "./engine/orchestrator";
import { buildFilename, sanitizeFilename } from "./engine/rename";
import type { ScanEntry } from "./fs/scan";
import { planRenames, type RowOutcome } from "./fs/write";

export type RowStatus = "parsing" | "ready" | "incomplete" | "error" | "excluded";

export type Row = {
  original: string;
  status: RowStatus;
  proposed: string | null;
  manualName: string;
  finalName: string | null;
  collision: boolean;
  error?: string;
};

type ParseResult = { info: TransactionInfo; proposed: string | null };
type ParseFile = (entry: ScanEntry) => Promise<ParseResult>;

const MAX_CONCURRENT_PARSES = 4;

/** Parse every entry with four workers, keeping results in scan order. */
export async function parseAll(
  entries: ScanEntry[],
  parseFile: ParseFile,
  onProgress: (done: number, total: number) => void
): Promise<Row[]> {
  const rows: Row[] = entries.map((entry) => ({
    original: entry.name,
    status: "parsing",
    proposed: null,
    manualName: "",
    finalName: null,
    collision: false,
  }));
  let nextIndex = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (nextIndex < entries.length) {
      const index = nextIndex;
      nextIndex += 1;
      const current = entries[index];

      try {
        const { proposed } = await parseFile(current);
        rows[index] = {
          original: current.name,
          status: proposed === null ? "incomplete" : "ready",
          proposed,
          manualName: "",
          finalName: null,
          collision: false,
        };
      } catch (error) {
        rows[index] = {
          original: current.name,
          status: "error",
          proposed: null,
          manualName: "",
          finalName: null,
          collision: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      done += 1;
      onProgress(done, entries.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_PARSES, entries.length) }, () =>
      worker()
    )
  );
  return rows;
}

/** Real parser, dynamically imported so injecting a fake never loads pdf.js. */
export async function defaultParseFile(entry: ScanEntry): Promise<ParseResult> {
  const data = await entry.file.arrayBuffer();
  const { extractPdfText } = await import("./pdf/text");
  const text = await extractPdfText(data);
  const info = extractInfo(text);
  return { info, proposed: buildFilename(info) };
}

/** Set a manual filename, returning a new row array. */
export function setManualName(rows: Row[], original: string, name: string): Row[] {
  return rows.map((row) =>
    row.original === original ? { ...row, manualName: name } : row
  );
}

/** Exclude a row, or restore the status implied by its parse result. */
export function toggleRow(rows: Row[], original: string): Row[] {
  return rows.map((row) => {
    if (row.original !== original) {
      return row;
    }
    if (row.status !== "excluded") {
      return { ...row, status: "excluded" };
    }

    const status: RowStatus =
      row.error !== undefined
        ? "error"
        : row.proposed === null
          ? "incomplete"
          : "ready";
    return { ...row, status };
  });
}

/** Plan sanitized manual names and auto names together, preserving each row's proposal. */
export function computePlan(rows: Row[], existingNames: Set<string>): Row[] {
  const planned = planRenames(
    rows.map((row) => ({
      ...row,
      proposed:
        row.status === "excluded"
          ? null
          : row.manualName.trim() !== ""
            ? sanitizeFilename(row.manualName)
            : row.proposed,
    })),
    existingNames
  );

  return planned.map((plannedRow, index) => ({
    ...rows[index],
    finalName: plannedRow.finalName,
    collision: plannedRow.collision,
  }));
}

/** Summarize successful writes/moves, unattempted rows, and failures. */
export function summary(rows: Row[], outcomes: RowOutcome[]): string {
  const renamed = outcomes.filter(
    (outcome) => outcome.status === "written" || outcome.status === "moved"
  ).length;
  const failed = outcomes.filter((outcome) => outcome.status === "failed").length;
  const skipped = rows.length - outcomes.length;
  return `${renamed} renamed, ${skipped} skipped, ${failed} failed`;
}
