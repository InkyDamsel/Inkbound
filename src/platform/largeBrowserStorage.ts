const DB_NAME = 'inkbound-large-storage';
const STORE_NAME = 'entries';
const DB_VERSION = 1;
const LOCAL_STORAGE_SOFT_LIMIT = 1_500_000;

const exactManagedKeys = new Set([
  'inkbound_books',
  'inkbound_import_enrichment_queue_v3',
  'inkbound_import_history_v1',
  'inkbound_import_metadata_pending_v1',
  'inkbound_import_verification_result_v2',
]);

const managedPrefixes = [
  'inkbound_pending_sync_',
  'inkbound_sync_baseline_',
];

const cache = new Map<string, string>();
let databasePromise: Promise<IDBDatabase | null> | null = null;
let installed = false;
let originalGetItem: Storage['getItem'] | null = null;
let originalSetItem: Storage['setItem'] | null = null;
let originalRemoveItem: Storage['removeItem'] | null = null;

function isManagedKey(key: string) {
  return exactManagedKeys.has(key) || managedPrefixes.some((prefix) => key.startsWith(prefix));
}

function isWindowLocalStorage(storage: Storage) {
  try {
    return typeof window !== 'undefined' && storage === window.localStorage;
  } catch {
    return false;
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
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
    request.onblocked = () => resolve(null);
  });
  return databasePromise;
}

async function putLargeValue(key: string, value: string) {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const request = transaction.objectStore(STORE_NAME).put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function deleteLargeValue(key: string) {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const request = transaction.objectStore(STORE_NAME).delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function readAllLargeValues(): Promise<Array<[string, string]>> {
  const database = await openDatabase();
  if (!database) return [];
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const keyRequest = store.getAllKeys();
      const valueRequest = store.getAll();
      let keys: IDBValidKey[] | null = null;
      let values: unknown[] | null = null;
      const finish = () => {
        if (!keys || !values) return;
        resolve(keys
          .map((key, index) => [String(key), typeof values![index] === 'string' ? values![index] as string : ''] as [string, string])
          .filter(([, value]) => value.length > 0));
      };
      keyRequest.onsuccess = () => { keys = keyRequest.result; finish(); };
      valueRequest.onsuccess = () => { values = valueRequest.result; finish(); };
      keyRequest.onerror = () => resolve([]);
      valueRequest.onerror = () => resolve([]);
      transaction.onerror = () => resolve([]);
      transaction.onabort = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

function installStorageBridge() {
  if (installed || typeof window === 'undefined' || typeof Storage === 'undefined') return;
  installed = true;

  originalGetItem = Storage.prototype.getItem;
  originalSetItem = Storage.prototype.setItem;
  originalRemoveItem = Storage.prototype.removeItem;

  Storage.prototype.getItem = function getItem(key: string): string | null {
    if (isWindowLocalStorage(this) && isManagedKey(key) && cache.has(key)) return cache.get(key) ?? null;
    return originalGetItem!.call(this, key);
  };

  Storage.prototype.setItem = function setItem(key: string, value: string): void {
    if (!isWindowLocalStorage(this) || !isManagedKey(key)) {
      originalSetItem!.call(this, key, value);
      return;
    }

    const normalized = String(value);
    cache.set(key, normalized);
    void putLargeValue(key, normalized);

    if (normalized.length > LOCAL_STORAGE_SOFT_LIMIT) {
      try { originalRemoveItem!.call(this, key); } catch { /* IndexedDB copy remains authoritative. */ }
      return;
    }

    try {
      originalSetItem!.call(this, key, normalized);
    } catch {
      try { originalRemoveItem!.call(this, key); } catch { /* IndexedDB copy remains authoritative. */ }
    }
  };

  Storage.prototype.removeItem = function removeItem(key: string): void {
    if (isWindowLocalStorage(this) && isManagedKey(key)) {
      cache.delete(key);
      void deleteLargeValue(key);
    }
    originalRemoveItem!.call(this, key);
  };
}

export function getLargeBrowserStorageKeys(): string[] {
  return [...cache.keys()];
}

export async function hydrateLargeBrowserStorage(): Promise<void> {
  if (typeof window === 'undefined' || typeof Storage === 'undefined' || typeof indexedDB === 'undefined') return;
  installStorageBridge();

  const storedEntries = await readAllLargeValues();
  storedEntries.forEach(([key, value]) => {
    if (isManagedKey(key)) cache.set(key, value);
  });

  // Migrate any still-small managed values from localStorage into IndexedDB so
  // they can grow past browser quota later without changing feature code.
  for (const key of Object.keys(window.localStorage)) {
    if (!isManagedKey(key) || cache.has(key)) continue;
    try {
      const value = originalGetItem?.call(window.localStorage, key);
      if (value !== null) {
        cache.set(key, value);
        await putLargeValue(key, value);
      }
    } catch {
      // Best effort only. Existing localStorage remains untouched.
    }
  }
}
