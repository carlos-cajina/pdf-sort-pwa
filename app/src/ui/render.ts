import type { Row } from "../state";

export type RenderState = {
  inputFolderName: string | null;
  outputFolderName: string | null;
  inputPermissionNeeded: boolean;
  outputPermissionNeeded: boolean;
  rows: Row[];
  scanned: boolean;
  progress: { done: number; total: number } | null;
  moveProcessed: boolean;
  summary: string | null;
  notice: string | null;
  busy: boolean;
};

export type RenderHandlers = {
  onPickInput: () => void;
  onPickOutput: () => void;
  onScan: () => void;
  onRename: () => void;
  onToggleRow: (original: string) => void;
  onManualName: (original: string, name: string) => void;
  onMoveProcessed: (move: boolean) => void;
};

/** Render the complete app surface. State transitions and IO stay in main.ts. */
export function renderApp(
  state: RenderState,
  handlers: RenderHandlers
): HTMLElement {
  const supported = "showDirectoryPicker" in window;
  const app = document.createElement("main");
  const heading = document.createElement("h1");
  heading.textContent = "PDF Sort";
  app.append(heading);

  if (!supported) {
    const banner = document.createElement("p");
    banner.setAttribute("role", "alert");
    banner.textContent =
      "Folder picking requires Chrome or Edge. Use a current desktop version to scan and rename PDFs.";
    app.append(banner);
  }

  if (state.notice !== null) {
    const notice = document.createElement("p");
    notice.setAttribute("role", "alert");
    notice.textContent = state.notice;
    app.append(notice);
  }

  const controls = document.createElement("section");
  controls.setAttribute("aria-label", "Folders and actions");
  controls.append(
    folderControl(
      "Input",
      state.inputFolderName,
      state.inputPermissionNeeded,
      state.busy || !supported,
      handlers.onPickInput
    ),
    folderControl(
      "Output",
      state.outputFolderName,
      state.outputPermissionNeeded,
      state.busy || !supported,
      handlers.onPickOutput
    )
  );

  const scan = actionButton(
    "Scan",
    state.busy ||
      !supported ||
      state.inputFolderName === null ||
      state.outputFolderName === null,
    handlers.onScan
  );
  controls.append(scan);

  const renameCount = state.rows.filter(
    (row) =>
      row.status !== "excluded" &&
      (row.finalName !== null ||
        (row.status === "incomplete" && row.manualName.trim() !== ""))
  ).length;
  const rename = actionButton(
    `Rename ${renameCount} files`,
    state.busy ||
      !supported ||
      state.progress !== null ||
      state.inputFolderName === null ||
      state.outputFolderName === null ||
      renameCount === 0,
    handlers.onRename
  );
  controls.append(rename);

  const moveLabel = document.createElement("label");
  const move = document.createElement("input");
  move.type = "checkbox";
  move.checked = state.moveProcessed;
  move.disabled = state.busy;
  move.setAttribute("aria-label", "Move originals to processed");
  move.addEventListener("change", () => {
    handlers.onMoveProcessed(move.checked);
  });
  moveLabel.append(move, document.createTextNode(" Move originals to processed"));
  controls.append(moveLabel);
  app.append(controls);

  if (state.progress !== null) {
    const progressLabel = document.createElement("label");
    progressLabel.textContent = `Parsing ${state.progress.done} of ${state.progress.total} PDFs `;
    const progress = document.createElement("progress");
    progress.max = state.progress.total;
    progress.value = state.progress.done;
    progress.setAttribute("aria-label", "Parsing PDFs");
    progressLabel.append(progress);
    app.append(progressLabel);
  }

  if (state.rows.length > 0) {
    app.append(renderRows(state.rows, state.busy, handlers));
  } else if (
    state.scanned &&
    state.progress === null &&
    state.notice === null
  ) {
    const empty = document.createElement("p");
    empty.textContent = "No PDFs found in input folder";
    app.append(empty);
  } else if (
    !state.scanned &&
    state.progress === null &&
    !state.busy &&
    state.notice === null
  ) {
    const empty = document.createElement("p");
    empty.textContent = "Choose input and output folders, then select Scan.";
    app.append(empty);
  }

  if (state.summary !== null) {
    const summary = document.createElement("p");
    summary.setAttribute("role", "status");
    summary.textContent = state.summary;
    app.append(summary);
  }

  return app;
}

function folderControl(
  label: string,
  folderName: string | null,
  permissionNeeded: boolean,
  disabled: boolean,
  onPick: () => void
): HTMLElement {
  const container = document.createElement("div");
  const name = document.createElement("span");
  name.textContent = `${label}: ${folderName ?? "no folder selected"}`;
  container.append(name);

  if (folderName !== null && permissionNeeded) {
    const permission = document.createElement("span");
    permission.textContent = ` ${label} permission needed on Scan`;
    container.append(permission);
  }

  container.append(
    actionButton(
      folderName === null ? `Choose ${label.toLowerCase()} folder` : `Change ${label.toLowerCase()} folder`,
      disabled,
      onPick
    )
  );
  return container;
}

function actionButton(
  label: string,
  disabled: boolean,
  onClick: () => void
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function renderRows(
  rows: Row[],
  busy: boolean,
  handlers: RenderHandlers
): HTMLTableElement {
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const label of ["Include", "Status", "Original", "", "New name"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    if (label === "") {
      // The arrow column has no header text; keep it out of the a11y tree.
      cell.setAttribute("aria-hidden", "true");
    }
    headerRow.append(cell);
  }
  head.append(headerRow);
  table.append(head);

  const body = document.createElement("tbody");
  for (const row of rows) {
    const tableRow = document.createElement("tr");

    const includeCell = document.createElement("td");
    const include = document.createElement("input");
    include.type = "checkbox";
    include.checked = row.status !== "excluded";
    include.disabled = busy;
    include.setAttribute("aria-label", `Include ${row.original}`);
    include.addEventListener("change", () => {
      handlers.onToggleRow(row.original);
    });
    includeCell.append(include);
    tableRow.append(includeCell);

    const status = document.createElement("td");
    status.textContent = statusGlyph(row);
    status.title = row.status;
    tableRow.append(status);

    const original = document.createElement("td");
    original.textContent = row.original;
    tableRow.append(original);

    const arrow = document.createElement("td");
    arrow.textContent = "→";
    tableRow.append(arrow);

    const name = document.createElement("td");
    if (row.status === "incomplete") {
      const input = document.createElement("input");
      input.type = "text";
      input.value = row.manualName;
      input.disabled = busy;
      input.placeholder = "Enter filename.pdf";
      input.setAttribute("aria-label", `New name for ${row.original}`);
      input.dataset.manualNameFor = row.original;
      input.addEventListener("change", () => {
        handlers.onManualName(row.original, input.value);
      });
      name.append(input);
    } else if (row.status === "error") {
      name.textContent = row.error ?? "Unable to parse PDF";
    } else if (row.status === "parsing") {
      name.textContent = "Parsing…";
    } else {
      name.textContent = row.finalName ?? row.proposed ?? row.manualName;
    }

    if (row.collision) {
      const collision = document.createElement("span");
      collision.textContent = " collision — bumped to avoid overwrite";
      name.append(collision);
    }
    tableRow.append(name);
    body.append(tableRow);
  }
  table.append(body);
  return table;
}

function statusGlyph(row: Row): string {
  switch (row.status) {
    case "ready":
      return "✓";
    case "incomplete":
      return "⚠";
    case "error":
      return "✕";
    case "excluded":
      return "—";
    case "parsing":
      return "…";
  }
}
