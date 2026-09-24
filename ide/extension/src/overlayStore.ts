/**
 * Persists the candidate's changes to the workspace in IndexedDB so that a page
 * refresh doesn't lose their work. Only paths that differ from the seeded
 * workspace are stored; deletions are stored as tombstones.
 */

export interface OverlayRecord {
  /** Project relative path, e.g. `src/TodoList.tsx` */
  path: string;
  kind: "file" | "dir" | "deleted";
  data?: Uint8Array;
  ctime: number;
  mtime: number;
}

const DB_NAME = "todo-ide-workspace";
const FILES = "files";
const META = "meta";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class OverlayStore {
  private readonly db: Promise<IDBDatabase | undefined>;

  constructor() {
    this.db = new Promise<IDBDatabase | undefined>((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(FILES, { keyPath: "path" });
          request.result.createObjectStore(META);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          console.warn("Unable to open IndexedDB, changes will not persist", request.error);
          resolve(undefined);
        };
      } catch (e) {
        console.warn("IndexedDB unavailable, changes will not persist", e);
        resolve(undefined);
      }
    });
  }

  async isPersistent(): Promise<boolean> {
    return (await this.db) !== undefined;
  }

  async getAll(): Promise<OverlayRecord[]> {
    const db = await this.db;
    if (!db) return [];
    return promisify(db.transaction(FILES).objectStore(FILES).getAll());
  }

  async put(records: OverlayRecord[]): Promise<void> {
    const db = await this.db;
    if (!db || records.length === 0) return;
    const tx = db.transaction(FILES, "readwrite");
    const store = tx.objectStore(FILES);
    for (const record of records) {
      store.put(record);
    }
    await done(tx);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const db = await this.db;
    if (!db) return undefined;
    return promisify(db.transaction(META).objectStore(META).get(key));
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const db = await this.db;
    if (!db) return;
    const tx = db.transaction(META, "readwrite");
    tx.objectStore(META).put(value, key);
    await done(tx);
  }

  async clear(): Promise<void> {
    const db = await this.db;
    if (!db) return;
    const tx = db.transaction([FILES, META], "readwrite");
    tx.objectStore(FILES).clear();
    tx.objectStore(META).clear();
    await done(tx);
  }
}
