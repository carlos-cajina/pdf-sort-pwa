import { describe, it, expect } from "vitest";
import {
  planRenames,
  executeRenames,
  readExistingNames,
  type RenameRow,
} from "../write";
import { fakeDir, fakeFile } from "./fakes";

function makeRow(
  original: string,
  finalName: string | null,
  content: string,
  kind: "auto" | "manual" = "auto"
): RenameRow {
  const file = new File([content], original);
  return { original, bytes: () => file.arrayBuffer(), finalName, kind, collision: false };
}

async function entryNames(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const out: string[] = [];
  for await (const handle of dir.values()) {
    out.push(handle.name);
  }
  return out.sort();
}

describe("planRenames", () => {
  it("bumps a name that already exists in the output folder to _2 and flags the collision", () => {
    const rows = [
      { original: "a.pdf", proposed: "taken.pdf" },
      { original: "b.pdf", proposed: "fresh.pdf" },
    ];

    const planned = planRenames(rows, new Set(["taken.pdf"]));

    expect(planned).toEqual([
      { original: "a.pdf", proposed: "taken.pdf", finalName: "taken_2.pdf", collision: true },
      { original: "b.pdf", proposed: "fresh.pdf", finalName: "fresh.pdf", collision: false },
    ]);
    // pure: the inputs are untouched
    expect(rows).toEqual([
      { original: "a.pdf", proposed: "taken.pdf" },
      { original: "b.pdf", proposed: "fresh.pdf" },
    ]);
  });

  it("assigns _2 then _3 to in-run duplicates (deduplicate semantics)", () => {
    const rows = [
      { original: "a.pdf", proposed: "dup.pdf" },
      { original: "b.pdf", proposed: "dup.pdf" },
      { original: "c.pdf", proposed: "dup.pdf" },
    ];

    const planned = planRenames(rows, new Set());

    expect(planned.map((r) => r.finalName)).toEqual(["dup.pdf", "dup_2.pdf", "dup_3.pdf"]);
    expect(planned.map((r) => r.collision)).toEqual([false, false, false]);
  });

  it("bumps past names the run itself already assigned when dodging an existing name", () => {
    const rows = [
      { original: "a.pdf", proposed: "x.pdf" },
      { original: "b.pdf", proposed: "x.pdf" },
    ];

    const planned = planRenames(rows, new Set(["x.pdf"]));

    expect(planned.map((r) => r.finalName)).toEqual(["x_3.pdf", "x_2.pdf"]);
    expect(planned.map((r) => r.collision)).toEqual([true, false]);
  });

  it("keeps proposed null (excluded or left blank) as finalName null", () => {
    const planned = planRenames([{ original: "skip.pdf", proposed: null }], new Set());

    expect(planned).toEqual([
      { original: "skip.pdf", proposed: null, finalName: null, collision: false },
    ]);
  });
});

describe("executeRenames", () => {
  it("sanitizes manual names at write time (my/receipt:1.pdf → my_receipt_1.pdf)", async () => {
    const inputDir = fakeDir([fakeFile("orig1.pdf", "content-1")]);
    const outputDir = fakeDir([]);

    const outcomes = await executeRenames(
      inputDir,
      outputDir,
      [makeRow("orig1.pdf", "my/receipt:1.pdf", "content-1", "manual")],
      { moveProcessed: false }
    );

    expect(outcomes).toEqual([{ original: "orig1.pdf", status: "written" }]);
    expect(await entryNames(outputDir)).toEqual(["my_receipt_1.pdf"]);
    const written = await (await outputDir.getFileHandle("my_receipt_1.pdf")).getFile();
    expect(await written.text()).toBe("content-1");
    expect(await entryNames(inputDir)).toEqual(["orig1.pdf"]);
  });

  it("never touches excluded or blank rows (finalName null)", async () => {
    const inputDir = fakeDir([fakeFile("excluded.pdf", "secret")]);
    const outputDir = fakeDir([]);

    const outcomes = await executeRenames(
      inputDir,
      outputDir,
      [makeRow("excluded.pdf", null, "secret")],
      { moveProcessed: true }
    );

    expect(outcomes).toEqual([]);
    expect(await entryNames(outputDir)).toEqual([]);
    // no write, no processed/ dir, original untouched
    expect(await entryNames(inputDir)).toEqual(["excluded.pdf"]);
  });

  it("moves the original to processed/ (keeping its name) only after the output write succeeds", async () => {
    const inputDir = fakeDir([fakeFile("orig.pdf", "content-1")]);
    const outputDir = fakeDir([]);

    const outcomes = await executeRenames(
      inputDir,
      outputDir,
      [makeRow("orig.pdf", "renamed.pdf", "content-1")],
      { moveProcessed: true }
    );

    expect(outcomes).toEqual([{ original: "orig.pdf", status: "moved" }]);
    expect(await entryNames(outputDir)).toEqual(["renamed.pdf"]);
    // original gone from the top level, processed/ holds it under the ORIGINAL name
    expect(await entryNames(inputDir)).toEqual(["processed"]);
    const processed = await inputDir.getDirectoryHandle("processed");
    expect(await entryNames(processed)).toEqual(["orig.pdf"]);
    const moved = await (await processed.getFileHandle("orig.pdf")).getFile();
    expect(await moved.text()).toBe("content-1");
  });

  it("marks the row failed and leaves the original in place when the output write fails", async () => {
    const inputDir = fakeDir([fakeFile("orig.pdf", "content-1")]);
    const outputDir = fakeDir([]);
    (outputDir as any).getFileHandle = async () => {
      throw new DOMException("simulated quota failure", "QuotaExceededError");
    };

    const outcomes = await executeRenames(
      inputDir,
      outputDir,
      [makeRow("orig.pdf", "target.pdf", "content-1")],
      { moveProcessed: true }
    );

    expect(outcomes).toEqual([
      { original: "orig.pdf", status: "failed", error: "simulated quota failure" },
    ]);
    // data safety: original stays put, processed/ was never even created
    expect(await entryNames(inputDir)).toEqual(["orig.pdf"]);
    expect(await entryNames(outputDir)).toEqual([]);
  });

  it("continues the batch after a failed row (error per row, never aborts the run)", async () => {
    const inputDir = fakeDir([
      fakeFile("bad.pdf", "bad-bytes"),
      fakeFile("good.pdf", "good-bytes"),
    ]);
    const outputDir = fakeDir([]);
    const realGetFileHandle = outputDir.getFileHandle.bind(outputDir);
    (outputDir as any).getFileHandle = async (
      name: string,
      options?: { create?: boolean }
    ) => {
      if (name === "boom.pdf") {
        throw new DOMException("simulated quota failure", "QuotaExceededError");
      }
      return realGetFileHandle(name, options);
    };

    const outcomes = await executeRenames(
      inputDir,
      outputDir,
      [makeRow("bad.pdf", "boom.pdf", "bad-bytes"), makeRow("good.pdf", "fine.pdf", "good-bytes")],
      { moveProcessed: true }
    );

    expect(outcomes).toEqual([
      { original: "bad.pdf", status: "failed", error: "simulated quota failure" },
      { original: "good.pdf", status: "moved" },
    ]);
    expect(await entryNames(inputDir)).toEqual(["bad.pdf", "processed"]);
    const processed = await inputDir.getDirectoryHandle("processed");
    expect(await entryNames(processed)).toEqual(["good.pdf"]);
    expect(await entryNames(outputDir)).toEqual(["fine.pdf"]);
  });

  it("fails loudly when the output name appears after planning instead of overwriting", async () => {
    const inputDir = fakeDir([fakeFile("orig.pdf", "original-content")]);
    const outputDir = fakeDir([]);

    // Simulate a stale collision set: the name appears after planRenames/readExistingNames.
    const existing = await outputDir.getFileHandle("target.pdf", { create: true });
    const writable = await existing.createWritable();
    await writable.write("existing-content");
    await writable.close();

    const outcomes = await executeRenames(
      inputDir,
      outputDir,
      [makeRow("orig.pdf", "target.pdf", "original-content")],
      { moveProcessed: true }
    );

    expect(outcomes).toEqual([
      {
        original: "orig.pdf",
        status: "failed",
        error: "target.pdf already exists in output at write time; a plan may be stale",
        writeCollision: true,
      },
    ]);

    // The pre-existing file must NOT be clobbered.
    const file = await (await outputDir.getFileHandle("target.pdf")).getFile();
    expect(await file.text()).toBe("existing-content");
    // The original stays exactly where it was.
    expect(await entryNames(inputDir)).toEqual(["orig.pdf"]);
  });

  it("continues the batch after a write-time collision", async () => {
    const inputDir = fakeDir([
      fakeFile("collide.pdf", "collide-bytes"),
      fakeFile("good.pdf", "good-bytes"),
    ]);
    const outputDir = fakeDir([]);

    // Seed the collision after the plan-time read.
    const existing = await outputDir.getFileHandle("collision.pdf", { create: true });
    const writable = await existing.createWritable();
    await writable.write("existing-content");
    await writable.close();

    const outcomes = await executeRenames(
      inputDir,
      outputDir,
      [
        makeRow("collide.pdf", "collision.pdf", "collide-bytes"),
        makeRow("good.pdf", "fine.pdf", "good-bytes"),
      ],
      { moveProcessed: true }
    );

    expect(outcomes).toEqual([
      {
        original: "collide.pdf",
        status: "failed",
        error: "collision.pdf already exists in output at write time; a plan may be stale",
        writeCollision: true,
      },
      { original: "good.pdf", status: "moved" },
    ]);

    // Existing file untouched, new file written, unaffected original moved.
    const existingFile = await (await outputDir.getFileHandle("collision.pdf")).getFile();
    expect(await existingFile.text()).toBe("existing-content");
    const newFile = await (await outputDir.getFileHandle("fine.pdf")).getFile();
    expect(await newFile.text()).toBe("good-bytes");
    expect(await entryNames(inputDir)).toEqual(["collide.pdf", "processed"]);
    const processed = await inputDir.getDirectoryHandle("processed");
    expect(await entryNames(processed)).toEqual(["good.pdf"]);
  });
});

describe("readExistingNames", () => {
  it("collects the names of everything currently in the output folder", async () => {
    const outputDir = fakeDir([
      fakeFile("taken.pdf", "x"),
      fakeFile("notes.txt", "y"),
      { kind: "directory", name: "processed", entries: [] },
    ]);

    expect(await readExistingNames(outputDir)).toEqual(
      new Set(["taken.pdf", "notes.txt", "processed"])
    );
  });
});
