/// <reference types="wicg-file-system-access" />

export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  return window.showDirectoryPicker();
}

declare global {
  interface Window {
    showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
  }
}

export async function saveHandle(
  id: "input" | "output",
  handle: FileSystemDirectoryHandle
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    const store = tx.objectStore("handles");
    const request = store.put(handle, id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB put failed"));
  });
}

export async function loadHandle(
  id: "input" | "output"
): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readonly");
    const store = tx.objectStore("handles");
    const request = store.get(id);
    request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB get failed"));
  });
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pdf-sort", 1);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
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
