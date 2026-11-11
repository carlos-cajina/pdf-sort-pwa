export type ScanEntry = {
  name: string;
  file: File;
};

export async function scanInputFolder(
  dir: FileSystemDirectoryHandle
): Promise<ScanEntry[]> {
  const fileHandles: FileSystemFileHandle[] = [];

  for await (const handle of dir.values()) {
    if (handle.kind !== "file") {
      continue;
    }

    if (!/\.pdf$/i.test(handle.name)) {
      continue;
    }

    fileHandles.push(handle as FileSystemFileHandle);
  }

  // Match the Python CLI, which iterates sorted(input_dir.iterdir()): the
  // in-run dedup suffix assignment depends on row order, so the scan order
  // must be deterministic and identical to the reference implementation.
  fileHandles.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Resolve the Files concurrently — each getFile is independent — while
  // keeping the sorted scan order. A failing getFile still aborts the scan
  // loudly rather than silently dropping an entry.
  const files = await Promise.all(fileHandles.map((fileHandle) => fileHandle.getFile()));
  return fileHandles.map((fileHandle, index) => ({
    name: fileHandle.name,
    file: files[index]!,
  }));
}
