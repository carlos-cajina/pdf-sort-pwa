export type FakeEntry =
  | { kind: "file"; name: string; file: File }
  | { kind: "directory"; name: string; entries: FakeEntry[] };

export type FakeDirOptions = {
  name?: string;
  permission?: "granted" | "prompt" | "denied";
};

export function fakeFile(name: string, content: string | Blob = ""): FakeEntry {
  const blob = content instanceof Blob ? content : new Blob([content]);
  return { kind: "file", name, file: new File([blob], name) };
}

export function fakeDir(
  entries: FakeEntry[] = [],
  options: FakeDirOptions = {}
): FileSystemDirectoryHandle {
  const name = options.name ?? "";
  let permission = options.permission ?? "prompt";

  const children = new Map<string, FakeEntry>();
  for (const entry of entries) {
    children.set(entry.name, entry);
  }

  const dir: any = {
    kind: "directory",
    name,

    async *values(): AsyncIterableIterator<FileSystemHandle> {
      for (const entry of children.values()) {
        if (entry.kind === "file") {
          yield fileHandle(entry) as unknown as FileSystemHandle;
        } else {
          yield fakeDir(entry.entries, { name: entry.name, permission }) as FileSystemHandle;
        }
      }
    },

    async getFileHandle(
      entryName: string,
      _options?: { create?: boolean }
    ): Promise<FileSystemFileHandle> {
      const entry = children.get(entryName);
      if (!entry || entry.kind !== "file") {
        throw new DOMException(`Entry ${entryName} not found`, "NotFoundError");
      }
      return fileHandle(entry) as unknown as FileSystemFileHandle;
    },

    async getDirectoryHandle(
      entryName: string,
      _options?: { create?: boolean }
    ): Promise<FileSystemDirectoryHandle> {
      const entry = children.get(entryName);
      if (!entry || entry.kind !== "directory") {
        throw new DOMException(`Directory ${entryName} not found`, "NotFoundError");
      }
      return fakeDir(entry.entries, { name: entry.name, permission });
    },

    async removeEntry(entryName: string, _options?: { recursive?: boolean }): Promise<void> {
      if (!children.has(entryName)) {
        throw new DOMException(`Entry ${entryName} not found`, "NotFoundError");
      }
      children.delete(entryName);
    },

    async queryPermission(
      _descriptor?: { mode?: FileSystemPermissionMode }
    ): Promise<PermissionState> {
      return permission;
    },

    async requestPermission(
      _descriptor?: { mode?: FileSystemPermissionMode }
    ): Promise<PermissionState> {
      if (permission === "prompt") {
        permission = "granted";
      }
      return permission;
    },

    async isSameEntry(other: FileSystemHandle): Promise<boolean> {
      return other === dir;
    },

    async remove(_options?: { recursive?: boolean }): Promise<void> {
      // no-op for the in-memory double
    },
  };

  return dir as FileSystemDirectoryHandle;
}

function fileHandle(entry: Extract<FakeEntry, { kind: "file" }>): any {
  return {
    kind: "file",
    name: entry.name,

    async getFile(): Promise<File> {
      return entry.file;
    },

    async createWritable(): Promise<FileSystemWritableFileStream> {
      const chunks: BlobPart[] = [];
      return {
        async write(data: any) {
          if (data instanceof Blob) {
            chunks.push(data);
          } else if (typeof data === "string") {
            chunks.push(data);
          } else if (data && data.type === "write" && data.data !== undefined) {
            chunks.push(data.data);
          }
        },
        async close() {
          entry.file = new File(chunks, entry.name);
        },
        async seek(_position: number) {
          // no-op stub
        },
        async truncate(_size: number) {
          chunks.length = 0;
        },
      } as unknown as FileSystemWritableFileStream;
    },

    async queryPermission(
      _descriptor?: { mode?: FileSystemPermissionMode }
    ): Promise<PermissionState> {
      return "granted";
    },

    async requestPermission(
      _descriptor?: { mode?: FileSystemPermissionMode }
    ): Promise<PermissionState> {
      return "granted";
    },

    async isSameEntry(other: FileSystemHandle): Promise<boolean> {
      return other === this;
    },

    async remove(): Promise<void> {
      // no-op stub
    },
  };
}

class FakeDOMStringList {
  private items: string[] = [];

  contains(value: string): boolean {
    return this.items.includes(value);
  }

  item(index: number): string | null {
    return this.items[index] ?? null;
  }

  get length(): number {
    return this.items.length;
  }

  add(value: string): void {
    if (!this.items.includes(value)) {
      this.items.push(value);
    }
  }
}

class FakeDB {
  readonly objectStoreNames = new FakeDOMStringList();
  private stores = new Map<string, Map<IDBValidKey, unknown>>();

  createObjectStore(name: string): unknown {
    const store = new Map<IDBValidKey, unknown>();
    this.stores.set(name, store);
    this.objectStoreNames.add(name);
    return { name };
  }

  transaction(
    storeNames: string | string[],
    _mode?: IDBTransactionMode
  ): { objectStore(name: string): FakeObjectStore } {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    return {
      objectStore: (name: string): FakeObjectStore => {
        const data = this.stores.get(name) ?? new Map<IDBValidKey, unknown>();
        // Lazily register a store that was never created, matching IDB behavior well enough for tests.
        if (!this.stores.has(name)) {
          this.stores.set(name, data);
          this.objectStoreNames.add(name);
        }
        return new FakeObjectStore(data);
      },
    };
  }
}

class FakeObjectStore {
  constructor(private data: Map<IDBValidKey, unknown>) {}

  put(value: unknown, key?: IDBValidKey): IDBRequest {
    const request = newFakeRequest();
    queueMicrotask(() => {
      try {
        if (key === undefined) {
          throw new DOMException("Key required", "DataError");
        }
        this.data.set(String(key), value);
        (request as any).result = key;
        (request as any).readyState = "done";
        if (request.onsuccess) request.onsuccess({ target: request } as any);
      } catch (error) {
        (request as any).error = error;
        if (request.onerror) request.onerror({ target: request } as any);
      }
    });
    return request;
  }

  get(key: IDBValidKey): IDBRequest {
    const request = newFakeRequest();
    queueMicrotask(() => {
      (request as any).result = this.data.get(String(key));
      (request as any).readyState = "done";
      if (request.onsuccess) request.onsuccess({ target: request } as any);
    });
    return request;
  }
}

function newFakeRequest(): IDBRequest {
  return {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
    readyState: "pending",
  } as unknown as IDBRequest;
}

export function installFakeIndexedDB(): void {
  const dbs = new Map<string, FakeDB>();

  (globalThis as any).indexedDB = {
    open(name: string, version = 1): IDBOpenDBRequest {
      const request: any = {
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        readyState: "pending",
      };

      queueMicrotask(() => {
        let db = dbs.get(name);
        let upgraded = false;
        if (!db) {
          db = new FakeDB();
          dbs.set(name, db);
          upgraded = true;
        }

        request.result = db;

        if (upgraded && request.onupgradeneeded) {
          request.transaction = null;
          request.onupgradeneeded({
            target: request,
            oldVersion: 0,
            newVersion: version,
          });
        }

        request.readyState = "done";
        if (request.onsuccess) {
          request.onsuccess({ target: request });
        }
      });

      return request as IDBOpenDBRequest;
    },
  };
}
