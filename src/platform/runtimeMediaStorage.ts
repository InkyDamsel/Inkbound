export interface RuntimeMediaStorageAdapter {
  getBlob(key: string): Promise<Blob | null>;
  setBlob(key: string, value: Blob): Promise<void>;
  removeBlob(key: string): Promise<void>;
  getAllKeys(): Promise<string[]>;
}

const DB_NAME = 'inkbound-media';
const STORE_NAME = 'files';
const DB_VERSION = 1;
const memoryFallback = new Map<string, Blob>();
let databasePromise: Promise<IDBDatabase | null> | null = null;

function openBrowserMediaDatabase(): Promise<IDBDatabase | null> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return databasePromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, resolve: (value: T) => void) => void,
  fallback: () => T,
): Promise<T> {
  const database = await openBrowserMediaDatabase();
  if (!database) return fallback();
  return new Promise<T>((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, mode);
      operation(transaction.objectStore(STORE_NAME), resolve);
      transaction.onerror = () => resolve(fallback());
      transaction.onabort = () => resolve(fallback());
    } catch {
      resolve(fallback());
    }
  });
}

const browserMediaStorageAdapter: RuntimeMediaStorageAdapter = {
  getBlob: async (key) => withStore<Blob | null>(
    'readonly',
    (store, resolve) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
      request.onerror = () => resolve(memoryFallback.get(key) ?? null);
    },
    () => memoryFallback.get(key) ?? null,
  ),
  setBlob: async (key, value) => {
    memoryFallback.set(key, value);
    await withStore<void>(
      'readwrite',
      (store, resolve) => {
        const request = store.put(value, key);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
      },
      () => undefined,
    );
  },
  removeBlob: async (key) => {
    memoryFallback.delete(key);
    await withStore<void>(
      'readwrite',
      (store, resolve) => {
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
      },
      () => undefined,
    );
  },
  getAllKeys: async () => withStore<string[]>(
    'readonly',
    (store, resolve) => {
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result.map(String));
      request.onerror = () => resolve([...memoryFallback.keys()]);
    },
    () => [...memoryFallback.keys()],
  ),
};

let activeMediaStorageAdapter: RuntimeMediaStorageAdapter = browserMediaStorageAdapter;

/**
 * Binary-media boundary for photos and other large user-owned files.
 *
 * Web uses IndexedDB so media does not consume localStorage quota. Native shells
 * can install a filesystem/database-backed adapter without changing features.
 */
export function configureRuntimeMediaStorage(adapter: RuntimeMediaStorageAdapter) {
  activeMediaStorageAdapter = adapter;
}

export function readRuntimeMediaBlob(key: string): Promise<Blob | null> {
  return activeMediaStorageAdapter.getBlob(key);
}

export function writeRuntimeMediaBlob(key: string, value: Blob): Promise<void> {
  return activeMediaStorageAdapter.setBlob(key, value);
}

export function removeRuntimeMediaBlob(key: string): Promise<void> {
  return activeMediaStorageAdapter.removeBlob(key);
}

export async function removeRuntimeMediaByPrefix(prefix: string): Promise<void> {
  const keys = await activeMediaStorageAdapter.getAllKeys();
  await Promise.all(keys.filter((key) => key.startsWith(prefix)).map((key) => activeMediaStorageAdapter.removeBlob(key)));
}
