/** Rename planning (pure) and the write pipeline over the File System Access API. */

import { sanitizeFilename } from "../engine/rename";

/**
 * A row ready to write. The UI wiring (Task 12) builds these from the state
 * rows plus the scanned Files; `bytes` yields the original PDF's content and
 * `kind` tells the pipeline whether the name was typed by the user.
 */
export type RenameRow = {
  original: string;
  bytes: () => Promise<ArrayBuffer>;
  finalName: string | null;
  kind: "auto" | "manual";
  collision: boolean;
};

/** Per-row result of a rename run. */
export type RowOutcome = {
  original: string;
  status: "written" | "moved" | "failed";
  error?: string;
};

/** Names currently in the output folder — the collision set for planning. Read once up front. */
export async function readExistingNames(
  outputDir: FileSystemDirectoryHandle
): Promise<Set<string>> {
  const names = new Set<string>();
  for await (const handle of outputDir.values()) {
    names.add(handle.name);
  }
  return names;
}

/**
 * Plan final names: in-run dedup suffixes `_2`, `_3`… (port of the engine's
 * `deduplicate` semantics), then a further bump when the name already exists
 * in the output folder. A row is flagged `collision: true` only when it was
 * bumped because its name exists in the output folder (spec write-semantics
 * #2 — never a silent overwrite); in-run dedup suffixes are normal CLI-parity
 * behavior and do not flag.
 *
 * Pure: returns new objects, mutates nothing, performs no IO. Extra fields on
 * the input rows (e.g. `bytes`/`kind` for `RenameRow`) pass through untouched.
 */
export function planRenames<T extends { original: string; proposed: string | null }>(
  rows: T[],
  existingNames: Set<string>
): (T & { finalName: string | null; collision: boolean })[] {
  // Pass 1 — in-run dedup, mirroring the engine's `deduplicate` counter.
  const counter = new Map<string, number>();
  const planned = rows.map((row) => {
    if (row.proposed === null) {
      return { row, name: null as string | null, base: null as string | null, collision: false };
    }
    const count = (counter.get(row.proposed) ?? 0) + 1;
    counter.set(row.proposed, count);
    const base = stripPdfExt(row.proposed);
    if (count > 1) {
      return { row, name: `${base}_${count}.pdf`, base, collision: false };
    }
    return { row, name: row.proposed, base, collision: false };
  });

  // Every name this run occupies, so existing-name bumps dodge them too.
  const taken = new Set<string>();
  for (const p of planned) {
    if (p.name !== null) {
      taken.add(p.name);
    }
  }

  // Pass 2 — bump again when the name is already taken in the output folder.
  for (const p of planned) {
    if (p.name === null || p.base === null || !existingNames.has(p.name)) {
      continue;
    }
    let suffix = 2;
    let candidate = `${p.base}_${suffix}.pdf`;
    while (existingNames.has(candidate) || taken.has(candidate)) {
      suffix += 1;
      candidate = `${p.base}_${suffix}.pdf`;
    }
    p.name = candidate;
    p.collision = true;
    taken.add(candidate);
  }

  return planned.map((p) => ({ ...p.row, finalName: p.name, collision: p.collision }));
}

/** Same extension strip the engine's `deduplicate` uses. */
function stripPdfExt(name: string): string {
  return name.toLowerCase().endsWith(".pdf") ? name.slice(0, -4) : name;
}

/**
 * Write every row that has a final name to the output folder, directly under
 * its final name (manual names sanitized first — auto names are safe already).
 * With `moveProcessed`, the original is copied into `inputDir/processed/`
 * under its original name and removed from the input folder — but only after
 * that row's output write succeeded, so a failure always leaves the original
 * exactly where it was. A failed row is reported and the run continues; rows
 * with `finalName: null` (excluded or left blank) are never touched.
 */
export async function executeRenames(
  inputDir: FileSystemDirectoryHandle,
  outputDir: FileSystemDirectoryHandle,
  rows: RenameRow[],
  opts: { moveProcessed: boolean }
): Promise<RowOutcome[]> {
  const outcomes: RowOutcome[] = [];
  let processedDir: FileSystemDirectoryHandle | null = null;

  for (const row of rows) {
    if (row.finalName === null) {
      continue;
    }

    try {
      const bytes = await row.bytes();
      const writeName =
        row.kind === "manual" ? sanitizeFilename(row.finalName) : row.finalName;
      await writeBytes(outputDir, writeName, bytes);

      if (opts.moveProcessed) {
        if (processedDir === null) {
          processedDir = await inputDir.getDirectoryHandle("processed", { create: true });
        }
        await writeBytes(processedDir, row.original, bytes);
        await inputDir.removeEntry(row.original);
        outcomes.push({ original: row.original, status: "moved" });
      } else {
        outcomes.push({ original: row.original, status: "written" });
      }
    } catch (error) {
      outcomes.push({ original: row.original, status: "failed", error: errorMessage(error) });
    }
  }

  return outcomes;
}

/** One write, under the final name: create the handle, stream the bytes, close. */
async function writeBytes(
  dir: FileSystemDirectoryHandle,
  name: string,
  bytes: ArrayBuffer
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write({ type: "write", data: bytes });
  await writable.close();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
