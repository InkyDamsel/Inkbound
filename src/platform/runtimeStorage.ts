export interface RuntimeStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

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

export function removeRuntimeValue(key: string): boolean {
  try {
    activeStorageAdapter.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
