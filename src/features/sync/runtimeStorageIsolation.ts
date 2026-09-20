import { firebaseRuntimeMode } from '../../lib/firebase';
import { getRuntimeStorage, readRuntimeValue, writeRuntimeValue } from '../../platform/runtimeStorage';

const RUNTIME_MODE_STORAGE_KEY = 'inkbound_runtime_storage_mode_v1';
const RUNTIME_MODE_ARCHIVE_PREFIX = 'inkbound_runtime_mode_archive_v2_';

type RuntimeMode = 'emulator' | 'protected' | 'production';

interface RuntimeModeArchive {
  schemaVersion: 2;
  mode: RuntimeMode;
  savedAt: string;
  entries: Record<string, string>;
}

// These settings are device UI preferences, not reader/account data, so they are
// safe to carry between emulator development and intentional live-cloud checks.
const PRESERVED_LOCAL_KEYS = new Set([
  RUNTIME_MODE_STORAGE_KEY,
  'inkbound_theme',
  'inkbound_active_tab',
  'inkbound_navigation_collapsed_groups',
  'inkbound_notifications_read',
]);

const archiveKey = (mode: RuntimeMode) => `${RUNTIME_MODE_ARCHIVE_PREFIX}${mode}`;

function isModeArchiveKey(key: string) {
  return key.startsWith(RUNTIME_MODE_ARCHIVE_PREFIX);
}

function isAccountCacheKey(key: string) {
  if (PRESERVED_LOCAL_KEYS.has(key) || isModeArchiveKey(key)) return false;
  return key.startsWith('inkbound_') || key.startsWith('bookhaven_');
}

function saveModeArchive(mode: RuntimeMode, keys: string[]) {
  const storage = getRuntimeStorage();
  const entries: Record<string, string> = {};
  keys.forEach((key) => {
    const value = storage.getItem(key);
    if (value !== null) entries[key] = value;
  });
  const archive: RuntimeModeArchive = {
    schemaVersion: 2,
    mode,
    savedAt: new Date().toISOString(),
    entries,
  };
  storage.setItem(archiveKey(mode), JSON.stringify(archive));
}

function restoreModeArchive(mode: RuntimeMode): number {
  const storage = getRuntimeStorage();
  const raw = storage.getItem(archiveKey(mode));
  if (!raw) return 0;
  try {
    const archive = JSON.parse(raw) as Partial<RuntimeModeArchive>;
    if (archive.schemaVersion !== 2 || archive.mode !== mode || !archive.entries || typeof archive.entries !== 'object') return 0;
    let restored = 0;
    Object.entries(archive.entries).forEach(([key, value]) => {
      if (!isAccountCacheKey(key) || typeof value !== 'string') return;
      storage.setItem(key, value);
      restored += 1;
    });
    return restored;
  } catch {
    return 0;
  }
}

/**
 * Development runtimes can switch between emulator and live-cloud verification.
 * Keep those account caches isolated, but never discard the previous environment:
 * archive it locally first and restore the most recent cache for the target mode.
 * Production builds never execute this development-only boundary.
 */
export function isolateDevelopmentBrowserStorage() {
  if (!import.meta.env.DEV) return;

  try {
    const previousMode = readRuntimeValue(RUNTIME_MODE_STORAGE_KEY) as RuntimeMode | null;
    if (previousMode === firebaseRuntimeMode) return;

    const storage = getRuntimeStorage();
    const keysToRemove = storage.getAllKeys().filter(isAccountCacheKey);

    if (previousMode === 'emulator' || previousMode === 'protected' || previousMode === 'production') {
      saveModeArchive(previousMode, keysToRemove);
    }

    keysToRemove.forEach((key) => storage.removeItem(key));
    const restoredCount = restoreModeArchive(firebaseRuntimeMode);
    writeRuntimeValue(RUNTIME_MODE_STORAGE_KEY, firebaseRuntimeMode);

    console.info(
      `Inkbound DEV: isolated ${keysToRemove.length} ${previousMode ?? 'unassigned'} cache entr${keysToRemove.length === 1 ? 'y' : 'ies'} and restored ${restoredCount} ${firebaseRuntimeMode} cache entr${restoredCount === 1 ? 'y' : 'ies'}.`,
    );
  } catch (error) {
    console.warn('Inkbound could not isolate development runtime storage.', error);
  }
}
