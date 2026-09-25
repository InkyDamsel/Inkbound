import { notifyCloudDataUpdated } from '../features/sync/cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from '../features/sync/storageKeys';

const DB_NAME = 'inkbound-large-storage';
const STORE_NAME = 'entries';
const DB_VERSION = 1;
const LOCAL_STORAGE_SOFT_LIMIT = 1_500_000;

export const LARGE_BROWSER_STORAGE_HYDRATED_EVENT = 'inkbound:large-browser-storage-hydrated';

const exactManagedKeys = new Set([
  SYNC_STORAGE_KEYS.books,
  SYNC_STORAGE_KEYS.importEnrichmentQueue,
  'inkbound_import_history_v1',
  'inkbound_import_metadata_pending_v1',
  'inkbound_import_verification_result_v2',
]);

const managedPrefixes = [
  'inkbound_pending_sync_',
  'inkbound_sync_baseline_',
];

const STARTUP_EXACT_KEYS = new Set<string>([SYNC_STORAGE_KEYS.books]);
const STARTUP_PREFIXES = [
  'inkbound_pending_sync_',
  'inkbound_sync_baseline_',
];

const cache = new Map<string, string>();
const pendingWrites = new Set<Promise<void>>();
let databasePromise: Promise<IDBDatabase | null> | null = null;
let installed = false;
let startupHydrationPending = false;
let startupHydrationPromise: Promise<void> | null = null;
let deferredHydrationPromise: Promise<void> | null = null;
let originalGetItem: Storage['getItem'] | null = null;
let originalSetItem: Storage['setItem'] | null = null;
let originalRemoveItem: Storage['removeItem'] | null = null;

function isManagedKey(key: string) {
  return exactManagedKeys.has(key) || managedPrefixes.some((prefix) => key.startsWith(prefix));
}

function isStartupKey(key: string) {
  return STARTUP_EXACT_KEYS.has(key) || STARTUP_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function isWindowLocalStorage(storage: Storage) {
  try {
    return typeof window !== 'undefined' && storage === window.localStorage;
  } catch {
    return false;
  }
}

function announceStartupHydrated() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(LARGE_BROWSER_STORAGE_HYDRATED_EVENT));
  notifyCloudDataUpdated([SYNC_STORAGE_KEYS.books]);
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

async function putLargeValue(key: string, value: string): Promise<boolean> {
  const database = await openDatabase();
  if (!database) return false;
  return new Promise<boolean>((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(value, key);
      let settled = false;
      const finish = (saved: boolean) => {
        if (settled) return;
        settled = true;
        resolve(saved);
      };
      transaction.oncomplete = () => finish(true);
      transaction.onerror = () => finish(false);
      transaction.onabort = () => finish(false);
    } catch {
      resolve(false);
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
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      request.onerror = finish;
      transaction.oncomplete = finish;
      transaction.onerror = finish;
      transaction.onabort = finish;
    } catch {
      resolve();
    }
  });
}

function trackWrite(promise: Promise<unknown>) {
  const tracked = promise.then(() => undefined, () => undefined);
  pendingWrites.add(tracked);
  void tracked.finally(() => pendingWrites.delete(tracked));
}

async function readMatchingLargeValues(predicate: (key: string) => boolean): Promise<Array<[string, string]>> {
  const database = await openDatabase();
  if (!database) return [];

  return new Promise((resolve) => {
    const entries: Array<[string, string]> = [];
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(entries);
          return;
        }
        const key = String(cursor.key);
        if (predicate(key) && typeof cursor.value === 'string' && cursor.value.length > 0) entries.push([key, cursor.value]);
        cursor.continue();
      };
      request.onerror = () => resolve(entries);
      transaction.onerror = () => resolve(entries);
      transaction.onabort = () => resolve(entries);
    } catch {
      resolve(entries);
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

    if (startupHydrationPending && isStartupKey(key)) {
      throw new Error(`Inkbound blocked a write to ${key} until canonical large-storage hydration completed.`);
    }

    const normalized = String(value);

    // Canonical user data may not be published to React until at least one
    // synchronous durable write has completed and read back successfully.
    // IndexedDB remains the large-storage mirror, but an asynchronous attempt
    // alone is never treated as a successful save. If WebView/localStorage is
    // out of quota, throw so writeRuntimeJson() fails closed and the UI keeps the
    // previous library instead of showing phantom changes that disappear later.
    try {
      originalSetItem!.call(this, key, normalized);
      const verified = originalGetItem!.call(this, key);
      if (verified !== normalized) {
        throw new Error(`Inkbound could not verify the durable write for ${key}.`);
      }
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error(`Inkbound could not durably save ${key}.`);
    }

    cache.set(key, normalized);

    const persist = putLargeValue(key, normalized).then((saved) => {
      if (
        saved
        && normalized.length > LOCAL_STORAGE_SOFT_LIMIT
        && cache.get(key) === normalized
      ) {
        try {
          if (originalGetItem!.call(window.localStorage, key) === normalized) {
            originalRemoveItem!.call(window.localStorage, key);
          }
        } catch { /* Keeping the backup is safer than deleting uncertain state. */ }
      }
    });
    trackWrite(persist);
  };

  Storage.prototype.removeItem = function removeItem(key: string): void {
    if (isWindowLocalStorage(this) && isManagedKey(key)) {
      if (startupHydrationPending && isStartupKey(key)) {
        throw new Error(`Inkbound blocked a removal of ${key} until canonical large-storage hydration completed.`);
      }
      cache.delete(key);
      trackWrite(deleteLargeValue(key));
    }
    originalRemoveItem!.call(this, key);
  };

  window.addEventListener('beforeunload', (event) => {
    if (pendingWrites.size === 0) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

async function migrateManagedLocalStorageValues(predicate: (key: string) => boolean) {
  for (const key of Object.keys(window.localStorage)) {
    if (!isManagedKey(key) || !predicate(key)) continue;
    try {
      const value = originalGetItem?.call(window.localStorage, key);
      if (value !== null) {
        // A localStorage copy is written synchronously before IndexedDB. If the
        // two disagree after a crash/refresh, localStorage is the newer
        // write-ahead value and must repair the stale IndexedDB/cache copy.
        if (cache.get(key) !== value) {
          cache.set(key, value);
          await putLargeValue(key, value);
        }
      }
    } catch {
      // Best effort only. Existing localStorage remains untouched.
    }
  }
}

export function getLargeBrowserStorageKeys(): string[] {
  return [...cache.keys()];
}

export function hasPendingLargeBrowserStorageWrites(): boolean {
  return pendingWrites.size > 0;
}

export function isLargeBrowserStorageHydrated(): boolean {
  return startupHydrationPromise !== null && !startupHydrationPending;
}

export async function flushLargeBrowserStorage(): Promise<void> {
  while (pendingWrites.size > 0) await Promise.allSettled([...pendingWrites]);
}

export function prepareLargeBrowserStorageForStartup(): void {
  if (typeof window === 'undefined' || typeof Storage === 'undefined') return;
  startupHydrationPending = true;
  installStorageBridge();
}

export function hydrateLargeBrowserStorage(): Promise<void> {
  if (startupHydrationPromise) return startupHydrationPromise;
  if (typeof window === 'undefined' || typeof Storage === 'undefined') return Promise.resolve();

  installStorageBridge();
  startupHydrationPending = true;
  startupHydrationPromise = (async () => {
    if (typeof indexedDB !== 'undefined') {
      const startupEntries = await readMatchingLargeValues((key) => isManagedKey(key) && isStartupKey(key));
      startupEntries.forEach(([key, value]) => cache.set(key, value));
      await migrateManagedLocalStorageValues(isStartupKey);
    }
  })()
    .catch((error) => {
      console.warn('Inkbound could not fully restore large browser storage.', error);
    })
    .finally(() => {
      startupHydrationPending = false;
      announceStartupHydrated();
    });

  return startupHydrationPromise;
}

export function hydrateDeferredLargeBrowserStorage(): Promise<void> {
  if (deferredHydrationPromise) return deferredHydrationPromise;
  if (typeof window === 'undefined' || typeof Storage === 'undefined' || typeof indexedDB === 'undefined') return Promise.resolve();

  installStorageBridge();
  deferredHydrationPromise = (async () => {
    const deferredEntries = await readMatchingLargeValues((key) => isManagedKey(key) && !isStartupKey(key));
    deferredEntries.forEach(([key, value]) => {
      if (!cache.has(key)) cache.set(key, value);
    });
    await migrateManagedLocalStorageValues((key) => !isStartupKey(key));
  })().catch(() => undefined);

  return deferredHydrationPromise;
}
