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

  // Resolve the Files concurrently — each getFile is independent — while
  // keeping the directory-iteration scan order. A failing getFile still
  // aborts the scan loudly rather than silently dropping an entry.
  const files = await Promise.all(fileHandles.map((fileHandle) => fileHandle.getFile()));
  return fileHandles.map((fileHandle, index) => ({
    name: fileHandle.name,
    file: files[index]!,
  }));
}
