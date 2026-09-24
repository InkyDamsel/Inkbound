import { INKBOUND_STORAGE_NAMESPACE_PREFIX } from '../features/sync/storageKeys';
import { getLargeBrowserStorageKeys } from './largeBrowserStorage';
import { removeRuntimeMediaByPrefix } from './runtimeMediaStorage';

export interface RuntimeStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  getAllKeys(): string[];
}

export const INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT = 'inkbound:runtime-storage-refresh';
const INKBOUND_LOCAL_DATA_CHANGED_EVENT = 'inkbound:local-data-changed';

const browserStorageAdapter: RuntimeStorageAdapter = {
  getItem: (key) => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  },
  setItem: (key, value) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  },
  removeItem: (key) => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(key);
  },
  getAllKeys: () => {
    if (typeof window === 'undefined') return [];
    return [...new Set([...Object.keys(window.localStorage), ...getLargeBrowserStorageKeys()])];
  },
};

let activeStorageAdapter: RuntimeStorageAdapter = browserStorageAdapter;

/**
 * Single runtime-storage boundary for Inkbound UI preferences and local caches.
 *
 * The web build currently uses localStorage. A native shell can install an
 * adapter backed by its durable preferences/database layer during bootstrap
 * without changing feature components or hooks.
 */
export function configureRuntimeStorage(adapter: RuntimeStorageAdapter) {
  activeStorageAdapter = adapter;
}

export function getRuntimeStorage(): RuntimeStorageAdapter {
  return activeStorageAdapter;
}

/**
 * Use after an external source (for example cloud reconciliation) changes a
 * runtime value behind a mounted usePersistentState hook. Local hook mutations
 * do not need this signal because React state is already updated directly.
 */
export function notifyRuntimeStorageChanged(key: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT, { detail: { key } }));
}

function notifyLocalRuntimeMutation(key: string) {
  if (typeof window === 'undefined') return;
  // Auxiliary account sync also listens to the canonical local-data event. Emit
  // it from the runtime-storage boundary so web localStorage and Android native
  // storage behave the same way. Canonical storage already has a debounced web
  // signal; duplicate canonical notifications are harmless because persistence
  // fingerprints remove no-op work, while auxiliary values now sync immediately
  // instead of waiting for the 30-second fallback poll.
  window.dispatchEvent(new CustomEvent(INKBOUND_LOCAL_DATA_CHANGED_EVENT, { detail: { keys: [key] } }));
}

export function readRuntimeJson<T>(key: string, fallback: T): T {
  try {
    const stored = activeStorageAdapter.getItem(key);
    return stored === null ? fallback : (JSON.parse(stored) as T);
  } catch {
    return fallback;
  }
}

export function writeRuntimeJson(key: string, value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value);
    if (activeStorageAdapter.getItem(key) === serialized) return true;
    activeStorageAdapter.setItem(key, serialized);
    notifyLocalRuntimeMutation(key);
    return true;
  } catch {
    return false;
  }
}

export function writeRuntimeValue(key: string, value: string): boolean {
  try {
    if (activeStorageAdapter.getItem(key) === value) return true;
    activeStorageAdapter.setItem(key, value);
    notifyLocalRuntimeMutation(key);
    return true;
  } catch {
    return false;
  }
}

export function readRuntimeValue(key: string): string | null {
  try {
    return activeStorageAdapter.getItem(key);
  } catch {
    return null;
  }
}

export function removeRuntimeValue(key: string): boolean {
  try {
    if (activeStorageAdapter.getItem(key) === null) return true;
    activeStorageAdapter.removeItem(key);
    notifyLocalRuntimeMutation(key);
    return true;
  } catch {
    return false;
  }
}

export function removeRuntimeValuesByPrefix(prefix: string): number {
  let removed = 0;
  try {
    activeStorageAdapter.getAllKeys()
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => {
        activeStorageAdapter.removeItem(key);
        removed += 1;
      });

    // A full Inkbound device wipe also owns large media blobs. This module is
    // already part of the app runtime for photo/profile media, so importing it
    // statically avoids a misleading split-chunk warning without increasing the
    // effective startup graph.
    if (prefix === INKBOUND_STORAGE_NAMESPACE_PREFIX) {
      void Promise.all([
        removeRuntimeMediaByPrefix('photo-memory:'),
        removeRuntimeMediaByPrefix('profile-media:'),
      ]);
    }
  } catch {
    return removed;
  }
  return removed;
}
