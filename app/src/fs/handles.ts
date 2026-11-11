/// <reference types="wicg-file-system-access" />

export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  return window.showDirectoryPicker({ mode: "readwrite" });
}

declare global {
  interface Window {
    showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
  }
}

let persistenceRequested = false;

/**
 * Ask the browser to keep this origin's stored folder handles durable.
 *
 * Must be called from a user gesture (first folder pick or Scan); a
 * module-level latch keeps it to one request per session. Guests and
 * unsupported browsers simply skip it; the result is advisory and ignored.
 */
export function requestPersistentStorage(): void {
  if (persistenceRequested) {
    return;
  }
  persistenceRequested = true;
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.persist === "function"
  ) {
    void navigator.storage.persist().catch(() => {});
  }
}

export async function saveHandle(
  id: "input" | "output",
  handle: FileSystemDirectoryHandle
): Promise<void> {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("handles", "readwrite");
      const store = tx.objectStore("handles");
      const request = store.put(handle, id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("IndexedDB put failed"));
    });
  } finally {
    db.close();
  }
}

export async function loadHandle(
  id: "input" | "output"
): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("handles", "readonly");
      const store = tx.objectStore("handles");
      const request = store.get(id);
      request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB get failed"));
    });
  } finally {
    db.close();
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pdf-sort", 1);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () =>
      reject(new Error("IndexedDB open blocked by another tab holding pdf-sort"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("handles")) {
        db.createObjectStore("handles");
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function getPermission(
  handle: FileSystemHandle
): Promise<"granted" | "prompt" | "denied"> {
  return handle.queryPermission({ mode: "readwrite" });
}

/** Requests read/write permission. Must only be called from a user gesture. */
export async function requestPermission(handle: FileSystemHandle): Promise<boolean> {
  const result = await handle.requestPermission({ mode: "readwrite" });
  return result === "granted";
}
