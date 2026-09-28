import { notifyCloudDataUpdated } from '../features/sync/cloudSyncEvents';
import { IMPORT_STORAGE_KEYS, SYNC_STORAGE_KEYS, SYNC_STORAGE_PREFIXES } from '../features/sync/storageKeys';

const DB_NAME = 'inkbound-large-storage';
const STORE_NAME = 'entries';
const DB_VERSION = 1;
const LOCAL_STORAGE_SOFT_LIMIT = 1_500_000;

export const LARGE_BROWSER_STORAGE_HYDRATED_EVENT = 'inkbound:large-browser-storage-hydrated';

const exactManagedKeys = new Set([
  SYNC_STORAGE_KEYS.books,
  SYNC_STORAGE_KEYS.importEnrichmentQueue,
  IMPORT_STORAGE_KEYS.history,
  IMPORT_STORAGE_KEYS.metadataPending,
  IMPORT_STORAGE_KEYS.verificationSnapshot,
]);

const managedPrefixes = [
  SYNC_STORAGE_PREFIXES.pending,
  SYNC_STORAGE_PREFIXES.baseline,
];

const STARTUP_EXACT_KEYS = new Set([SYNC_STORAGE_KEYS.books]);
const STARTUP_PREFIXES = [
  SYNC_STORAGE_PREFIXES.pending,
  SYNC_STORAGE_PREFIXES.baseline,
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
  // App already listens for cloud-data updates and reloads its canonical books
  // collection. Reuse that path so a library restored from IndexedDB appears as
  // soon as background hydration finishes, without reloading the page.
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
        if (predicate(key) && typeof cursor.value === 'string' && cursor.value.length > 0) {
          entries.push([key, cursor.value]);
        }
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

    // React mounts before IndexedDB restoration now. During that brief window the
    // app may try to persist its initial empty state. Never let that overwrite the
    // reader's authoritative IndexedDB library or sync baselines.
    if (startupHydrationPending && isStartupKey(key)) return;

    const normalized = String(value);
    cache.set(key, normalized);

    // localStorage is the synchronous write-ahead copy when it fits. Do not
    // discard an oversized-but-still-storable new value until IndexedDB has
    // actually committed it; otherwise a fast refresh can resurrect the older
    // IndexedDB snapshot and make loans/collections appear to disappear.
    let localBackupWritten = false;
    try {
      originalSetItem!.call(this, key, normalized);
      localBackupWritten = true;
    } catch {
      try { originalRemoveItem!.call(this, key); } catch { /* IndexedDB remains the only durable target. */ }
    }

    const persist = putLargeValue(key, normalized).then((saved) => {
      if (
        saved
        && normalized.length > LOCAL_STORAGE_SOFT_LIMIT
        && localBackupWritten
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
      if (startupHydrationPending && isStartupKey(key)) return;
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

/**
 * Synchronous readiness probe for React gates. The hydration event can fire before
 * a component effect subscribes on fast browsers (notably Safari/iPad). Consumers
 * must be able to observe the already-completed state instead of waiting forever
 * for an event that has already happened.
 */
export function isLargeBrowserStorageHydrated(): boolean {
  return startupHydrationPromise !== null && !startupHydrationPending;
}

export async function flushLargeBrowserStorage(): Promise<void> {
  while (pendingWrites.size > 0) {
    await Promise.allSettled([...pendingWrites]);
  }
}

/**
 * Install the localStorage bridge synchronously so React can render immediately.
 * Startup-managed writes are temporarily protected until IndexedDB restoration
 * completes, preventing an empty first render from clobbering an existing library.
 */
export function prepareLargeBrowserStorageForStartup(): void {
  if (typeof window === 'undefined' || typeof Storage === 'undefined') return;
  startupHydrationPending = true;
  installStorageBridge();
}

/**
 * Restore the working library and sync-critical values after the application shell
 * is already visible. Nothing in this path is allowed to gate first paint.
 */
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

/** Load non-critical import/history caches after the app is already visible. */
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
