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
  if (original === undefined) {
    return false;
  }
  const row = rows.find((candidate) => candidate.original === original);
  // Compare against the canonical (trimmed) value that gets committed, so a
  // whitespace-only difference is not reported as a change.
  if (row === undefined || row.manualName === input.value.trim()) {
    return false;
  }
  // Store the trimmed value: planning and inclusion both use manualName.trim().
  commit(original, input.value.trim());
  return true;
}
