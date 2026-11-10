import type { Row } from "../state";

/** Commit the focused manual-name input when its value differs from state. */
export function flushFocusedManualName(
  rows: Row[],
  commit: (original: string, name: string) => void
): boolean {
  const input = document.activeElement;
  if (!(input instanceof HTMLInputElement)) {
    return false;
  }
  const original = input.dataset.manualNameFor;
  const row = rows.find((candidate) => candidate.original === original);
  if (original === undefined || row === undefined || row.manualName === input.value) {
    return false;
  }
  commit(original, input.value);
  return true;
}
