// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { computePlan, setManualName, type Row } from "../../state";
import { flushFocusedManualName } from "../manual-name";

function makeIncompleteRow(): Row {
  return {
    original: "original.pdf",
    status: "incomplete",
    proposed: null,
    manualName: "",
    finalName: null,
    collision: false,
  };
}

function focusDirtyInput(original: string, value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.dataset.manualNameFor = original;
  input.value = value;
  document.body.append(input);
  input.focus();
  return input;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("flushFocusedManualName", () => {
  it("commits a focused dirty input to state before planning", () => {
    let rows = [makeIncompleteRow()];
    const existingNames = new Set<string>();
    focusDirtyInput("original.pdf", "typed.pdf");

    const committed = flushFocusedManualName(rows, (original, name) => {
      rows = computePlan(setManualName(rows, original, name), existingNames);
    });
    const planned = computePlan(rows, existingNames);

    expect(committed).toBe(true);
    expect(rows[0]?.manualName).toBe("typed.pdf");
    expect(planned[0]?.finalName).toBe("typed.pdf");
  });

  it("does not commit the same focused value twice", () => {
    let rows = [makeIncompleteRow()];
    focusDirtyInput("original.pdf", "typed.pdf");
    const commit = vi.fn((original: string, name: string) => {
      rows = setManualName(rows, original, name);
    });

    expect(flushFocusedManualName(rows, commit)).toBe(true);
    expect(flushFocusedManualName(rows, commit)).toBe(false);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(rows[0]?.manualName).toBe("typed.pdf");
  });

  it("lets a Rename-type handler plan the typed name on the first invocation", () => {
    let rows = [makeIncompleteRow()];
    const existingNames = new Set<string>();
    focusDirtyInput("original.pdf", "first-click.pdf");
    const rename = (): Row[] => {
      flushFocusedManualName(rows, (original, name) => {
        rows = setManualName(rows, original, name);
      });
      return computePlan(rows, existingNames);
    };

    const planned = rename();

    expect(planned[0]?.manualName).toBe("first-click.pdf");
    expect(planned[0]?.finalName).toBe("first-click.pdf");
  });
});
