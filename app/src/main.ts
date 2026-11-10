import {
  getPermission,
  loadHandle,
  pickFolder,
  requestPermission,
  saveHandle,
} from "./fs/handles";
import { scanInputFolder, type ScanEntry } from "./fs/scan";
import {
  executeRenames,
  readExistingNames,
  type RenameRow,
  type RowOutcome,
} from "./fs/write";
import {
  computePlan,
  defaultParseFile,
  parseAll,
  setManualName,
  summary,
  toggleRow,
  type Row,
} from "./state";
import {
  renderApp,
  type RenderHandlers,
  type RenderState,
} from "./ui/render";

const app = document.querySelector<HTMLDivElement>("#app");

let inputDir: FileSystemDirectoryHandle | null = null;
let outputDir: FileSystemDirectoryHandle | null = null;
let scannedEntries: ScanEntry[] = [];
let existingOutputNames = new Set<string>();

let state: RenderState = {
  inputFolderName: null,
  outputFolderName: null,
  inputPermissionNeeded: false,
  outputPermissionNeeded: false,
  rows: [],
  scanned: false,
  progress: null,
  moveProcessed: false,
  summary: null,
  notice: null,
  busy: false,
};

const handlers: RenderHandlers = {
  onPickInput: () => {
    void chooseFolder("input");
  },
  onPickOutput: () => {
    void chooseFolder("output");
  },
  onScan: () => {
    void scan();
  },
  onRename: () => {
    void rename();
  },
  onToggleRow: (original) => {
    const toggled = toggleRow(state.rows, original);
    state = {
      ...state,
      rows: computePlan(toggled, existingOutputNames),
      summary: null,
      notice: null,
    };
    render();
  },
  onManualName: (original, name) => {
    const edited = setManualName(state.rows, original, name);
    state = {
      ...state,
      rows: computePlan(edited, existingOutputNames),
      summary: null,
      notice: null,
    };
    render();
  },
  onMoveProcessed: (moveProcessed) => {
    state = { ...state, moveProcessed };
    render();
  },
};

function render(): void {
  app?.replaceChildren(renderApp(state, handlers));
}

async function restoreHandles(): Promise<void> {
  try {
    [inputDir, outputDir] = await Promise.all([
      loadHandle("input"),
      loadHandle("output"),
    ]);
    const [inputPermission, outputPermission] = await Promise.all([
      inputDir === null ? null : getPermission(inputDir),
      outputDir === null ? null : getPermission(outputDir),
    ]);
    state = {
      ...state,
      inputFolderName: inputDir?.name ?? null,
      outputFolderName: outputDir?.name ?? null,
      inputPermissionNeeded:
        inputDir !== null && inputPermission !== "granted",
      outputPermissionNeeded:
        outputDir !== null && outputPermission !== "granted",
    };
  } catch (error) {
    state = { ...state, notice: errorMessage(error) };
  } finally {
    render();
  }
}

async function chooseFolder(kind: "input" | "output"): Promise<void> {
  if (state.busy) {
    return;
  }
  state = { ...state, busy: true, notice: null };
  render();

  try {
    const handle = await pickFolder();
    await saveHandle(kind, handle);
    const permission = await getPermission(handle);

    if (kind === "input") {
      inputDir = handle;
    } else {
      outputDir = handle;
    }
    scannedEntries = [];
    existingOutputNames = new Set<string>();
    state = {
      ...state,
      inputFolderName: kind === "input" ? handle.name : state.inputFolderName,
      outputFolderName:
        kind === "output" ? handle.name : state.outputFolderName,
      inputPermissionNeeded:
        kind === "input" ? permission !== "granted" : state.inputPermissionNeeded,
      outputPermissionNeeded:
        kind === "output"
          ? permission !== "granted"
          : state.outputPermissionNeeded,
      rows: [],
      scanned: false,
      progress: null,
      summary: null,
    };
  } catch (error) {
    state = { ...state, notice: errorMessage(error) };
  } finally {
    state = { ...state, busy: false };
    render();
  }
}

/** Scan click is the only flow that calls requestPermission. */
async function scan(): Promise<void> {
  if (state.busy || inputDir === null || outputDir === null) {
    return;
  }
  const input = inputDir;
  const output = outputDir;
  state = {
    ...state,
    busy: true,
    rows: [],
    scanned: false,
    progress: null,
    summary: null,
    notice: null,
  };
  scannedEntries = [];
  render();

  try {
    // Start every needed request synchronously in this click handler, before
    // the first await, so none depends on a later non-gesture callback.
    const inputPermissionRequest = state.inputPermissionNeeded
      ? requestPermission(input)
      : null;
    const outputPermissionRequest = state.outputPermissionNeeded
      ? requestPermission(output)
      : null;
    const [inputGranted, outputGranted] = await Promise.all([
      inputPermissionRequest ?? Promise.resolve(true),
      outputPermissionRequest ?? Promise.resolve(true),
    ]);
    state = {
      ...state,
      inputPermissionNeeded: !inputGranted,
      outputPermissionNeeded: !outputGranted,
    };
    if (!inputGranted || !outputGranted) {
      state = {
        ...state,
        notice: "Read/write permission for both folders is required.",
      };
      return;
    }

    const entries = await scanInputFolder(input);
    scannedEntries = entries;
    if (entries.length === 0) {
      existingOutputNames = new Set<string>();
      state = { ...state, rows: [], scanned: true };
      return;
    }

    state = {
      ...state,
      progress: { done: 0, total: entries.length },
    };
    render();
    const parsed = await parseAll(
      entries,
      defaultParseFile,
      (done, total) => {
        state = { ...state, progress: { done, total } };
        render();
      }
    );

    const existingNames = await readExistingNames(output);
    existingOutputNames = existingNames;
    state = {
      ...state,
      rows: computePlan(parsed, existingNames),
      scanned: true,
      progress: null,
    };
  } catch (error) {
    state = {
      ...state,
      notice: errorMessage(error),
      progress: null,
      scanned: true,
    };
  } finally {
    state = { ...state, busy: false, progress: null };
    render();
  }
}

async function rename(): Promise<void> {
  if (state.busy || inputDir === null || outputDir === null) {
    return;
  }
  const input = inputDir;
  const output = outputDir;
  const moveProcessed = state.moveProcessed;
  state = { ...state, busy: true, notice: null, summary: null };
  render();

  try {
    // Plan only now, inside the write gesture, against names read now. Plans
    // rendered during scanning and edits are never reused for the write.
    const freshNames = await readExistingNames(output);
    existingOutputNames = freshNames;
    const planned = computePlan(state.rows, freshNames);
    state = { ...state, rows: planned };
    const renameRows = toRenameRows(planned, scannedEntries);
    if (renameRows.length === 0) {
      return;
    }

    let outcomes = await executeRenames(input, output, renameRows, {
      moveProcessed,
    });
    recordSuccessfulNames(planned, outcomes);

    const writeCollisions = outcomes.filter(
      (outcome) => outcome.writeCollision === true
    );
    if (writeCollisions.length > 0) {
      const collisionOriginals = writeCollisions
        .map((outcome) => outcome.original)
        .join(", ");
      const retry = window.confirm(
        `${writeCollisions.length} file(s) collided with a name that appeared in the output folder: ${collisionOriginals}. ` +
          "Select OK to re-read the folder, bump those names, and retry only those files once. " +
          "Select Cancel to leave those originals untouched."
      );
      if (retry) {
        outcomes = await retryWriteCollisions(
          input,
          output,
          writeCollisions,
          outcomes,
          moveProcessed
        );
      } else {
        state = {
          ...state,
          notice: `${writeCollisions.length} colliding file(s) were left untouched.`,
        };
      }
    }

    const remainingCollisions = outcomes.filter(
      (outcome) => outcome.writeCollision === true
    ).length;
    if (remainingCollisions > 0 && writeCollisions.length > 0) {
      state = {
        ...state,
        notice: `${remainingCollisions} colliding file(s) were left untouched after the run.`,
      };
    }
    state = { ...state, summary: summary(state.rows, outcomes) };
  } catch (error) {
    state = { ...state, notice: errorMessage(error) };
  } finally {
    state = { ...state, busy: false };
    render();
  }
}

async function retryWriteCollisions(
  input: FileSystemDirectoryHandle,
  output: FileSystemDirectoryHandle,
  collisions: RowOutcome[],
  outcomes: RowOutcome[],
  moveProcessed: boolean
): Promise<RowOutcome[]> {
  const collisionNames = new Set(collisions.map((outcome) => outcome.original));
  const collisionRows = state.rows.filter((row) =>
    collisionNames.has(row.original)
  );
  const freshNames = await readExistingNames(output);
  existingOutputNames = freshNames;
  const replanned = computePlan(collisionRows, freshNames);
  const replannedByOriginal = new Map(
    replanned.map((row) => [row.original, row])
  );
  state = {
    ...state,
    rows: state.rows.map(
      (row) => replannedByOriginal.get(row.original) ?? row
    ),
  };

  const retryOutcomes = await executeRenames(
    input,
    output,
    toRenameRows(replanned, scannedEntries),
    { moveProcessed }
  );
  recordSuccessfulNames(replanned, retryOutcomes);
  const retryByOriginal = new Map(
    retryOutcomes.map((outcome) => [outcome.original, outcome])
  );
  return outcomes.map(
    (outcome) => retryByOriginal.get(outcome.original) ?? outcome
  );
}

function toRenameRows(rows: Row[], entries: ScanEntry[]): RenameRow[] {
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]));
  const renameRows: RenameRow[] = [];

  for (const row of rows) {
    if (row.status === "excluded" || row.finalName === null) {
      continue;
    }
    const entry = entriesByName.get(row.original);
    if (!entry) {
      throw new Error(`Scanned file is missing: ${row.original}`);
    }
    renameRows.push({
      original: row.original,
      bytes: () => entry.file.arrayBuffer(),
      finalName: row.finalName,
      kind: row.manualName.trim() === "" ? "auto" : "manual",
      collision: row.collision,
    });
  }
  return renameRows;
}

function recordSuccessfulNames(rows: Row[], outcomes: RowOutcome[]): void {
  const rowsByOriginal = new Map(rows.map((row) => [row.original, row]));
  for (const outcome of outcomes) {
    if (outcome.status !== "written" && outcome.status !== "moved") {
      continue;
    }
    const finalName = rowsByOriginal.get(outcome.original)?.finalName;
    if (finalName != null) {
      existingOutputNames.add(finalName);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (app) {
  if ("showDirectoryPicker" in window) {
    void restoreHandles();
  } else {
    render();
  }
}
