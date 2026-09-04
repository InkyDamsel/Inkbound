import { getLargeBrowserStorageKeys } from './largeBrowserStorage';
import { removeRuntimeMediaByPrefix } from './runtimeMediaStorage';

export interface RuntimeStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  getAllKeys(): string[];
}

export const INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT = 'inkbound:runtime-storage-refresh';

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
    activeStorageAdapter.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function writeRuntimeValue(key: string, value: string): boolean {
  try {
    activeStorageAdapter.setItem(key, value);
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
    activeStorageAdapter.removeItem(key);
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
    if (prefix === 'inkbound_') {
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
