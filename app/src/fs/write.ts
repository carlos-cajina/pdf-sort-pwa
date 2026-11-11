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
  /** True when the row failed because its final name already existed in the output folder at write time. */
  writeCollision?: boolean;
  /** True when the row failed because its original name already exists in `processed/`. */
  processedCollision?: boolean;
  /**
   * Set on failed rows whose output file was nevertheless written before the
   * failure (e.g. the processed/ archive step): that name is now occupied in
   * the output folder and must join the collision set.
   */
  writtenName?: string;
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
 * exactly where it was. Before the output write, a row whose original name is
 * already archived in `processed/` fails loudly without writing anything, so a
 * repeat run can never overwrite a previously archived original. A failed row
 * is reported and the run continues; rows with `finalName: null` (excluded or
 * left blank) are never touched.
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

    // Set once the output write has landed, so a later failure can report
    // that the name is now occupied in the output folder.
    let writtenName: string | null = null;
    try {
      const bytes = await row.bytes();
      const writeName =
        row.kind === "manual" ? sanitizeFilename(row.finalName) : row.finalName;

      // Guard the processed/ archive BEFORE any write. A repeat name must
      // never clobber a previously archived original (writeBytes would
      // overwrite it in place); fail the row with nothing written at all.
      if (opts.moveProcessed) {
        if (processedDir === null) {
          processedDir = await findProcessedDir(inputDir);
        }
        if (processedDir !== null) {
          await assertNotInProcessed(processedDir, row.original);
        }
      }

      await writeNewFile(outputDir, writeName, bytes);
      writtenName = writeName;

      if (opts.moveProcessed) {
        if (processedDir === null) {
          processedDir = await inputDir.getDirectoryHandle("processed", { create: true });
        }
        try {
          // Re-probe right before the archive write: the first probe ran
          // before the output write, so an archived copy that appeared in
          // that window must still fail the row instead of being overwritten.
          await assertNotInProcessed(processedDir, row.original);
          await writeBytes(processedDir, row.original, bytes);
        } catch (error) {
          if (error instanceof ProcessedCollisionError) {
            // Re-throw as the same error type so the outer catch still marks
            // the row processedCollision, with the message corrected: the
            // output exists by now, so the pre-write wording would lie.
            throw new ProcessedCollisionError(
              row.original,
              `${writeName} was written, but processed/ already contains an archived copy of ${row.original}; the original was left in the input folder`
            );
          }
          throw error;
        }
        await inputDir.removeEntry(row.original);
        outcomes.push({ original: row.original, status: "moved" });
      } else {
        outcomes.push({ original: row.original, status: "written" });
      }
    } catch (error) {
      const written = writtenName === null ? {} : { writtenName };
      if (error instanceof WriteCollisionError) {
        outcomes.push({
          original: row.original,
          status: "failed",
          error: error.message,
          writeCollision: true,
          ...written,
        });
      } else if (error instanceof ProcessedCollisionError) {
        outcomes.push({
          original: row.original,
          status: "failed",
          error: error.message,
          processedCollision: true,
          ...written,
        });
      } else {
        outcomes.push({
          original: row.original,
          status: "failed",
          error: errorMessage(error),
          ...written,
        });
      }
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
  try {
    await writable.write({ type: "write", data: bytes });
  } catch (error) {
    // Release the stream on a failed write; an abandoned writable can keep
    // the file locked until the page unloads. The write error is the one
    // that matters for the row.
    await writable.close().catch(() => {});
    throw error;
  }
  // A close failure means the bytes may not have been flushed; let it fail
  // the row instead of reporting a write that did not commit.
  await writable.close();
}

/**
 * Write a new file only after proving the name does not already exist.
 * This is the write-time guard against stale collision sets: the probe must
 * raise NotFoundError before we create the file. If the probe finds an entry,
 * the write is rejected as a loud per-row failure instead of silently
 * overwriting.
 *
 * Residual race: the File System Access API has no atomic exclusive-create,
 * so a file that appears in the microscopic gap between this probe and the
 * create would still be overwritten. The window is best-effort narrowed here
 * and by re-reading the folder immediately before the batch.
 */
async function writeNewFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  bytes: ArrayBuffer
): Promise<void> {
  try {
    await dir.getFileHandle(name);
  } catch (error) {
    if (isNotFound(error)) {
      await writeBytes(dir, name, bytes);
      return;
    }
    throw error;
  }
  throw new WriteCollisionError(name);
}

class WriteCollisionError extends Error {
  constructor(name: string) {
    super(`${name} already exists in output at write time; a plan may be stale`);
  }
}

class ProcessedCollisionError extends Error {
  constructor(name: string, message?: string) {
    super(
      message ??
        `${name} already exists in processed/; clear or rename that archived copy before moving this original (nothing was written)`
    );
  }
}

/** The input folder's `processed/` directory, or null when it does not exist yet. */
async function findProcessedDir(
  inputDir: FileSystemDirectoryHandle
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await inputDir.getDirectoryHandle("processed");
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/** Reject when an archived original already occupies `name` in `processed/`. */
async function assertNotInProcessed(
  processedDir: FileSystemDirectoryHandle,
  name: string
): Promise<void> {
  try {
    await processedDir.getFileHandle(name);
  } catch (error) {
    if (isNotFound(error)) {
      return;
    }
    throw error;
  }
  throw new ProcessedCollisionError(name);
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
