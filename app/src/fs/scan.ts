export type ScanEntry = {
  name: string;
  file: File;
};

export async function scanInputFolder(
  dir: FileSystemDirectoryHandle
): Promise<ScanEntry[]> {
  const out: ScanEntry[] = [];

  for await (const handle of dir.values()) {
    if (handle.kind !== "file") {
      continue;
    }

    const name = handle.name;
    if (!/\.pdf$/i.test(name)) {
      continue;
    }

    const fileHandle = handle as FileSystemFileHandle;
    const file = await fileHandle.getFile();
    out.push({ name, file });
  }

  return out;
}
