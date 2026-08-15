import { firebaseRuntimeMode } from '../../lib/firebase';
import { getRuntimeStorage, readRuntimeValue, writeRuntimeValue } from '../../platform/runtimeStorage';

const RUNTIME_MODE_STORAGE_KEY = 'inkbound_runtime_storage_mode_v1';

// These settings are device UI preferences, not reader/account data, so they are
// safe to carry between emulator development and intentional live-cloud checks.
const PRESERVED_LOCAL_KEYS = new Set([
  RUNTIME_MODE_STORAGE_KEY,
  'inkbound_theme',
  'inkbound_active_tab',
  'inkbound_navigation_collapsed_groups',
  'inkbound_notifications_read',
]);

/**
 * Development runtimes can switch between emulator and live-cloud verification.
 * Clear account-owned caches whenever that mode changes so one environment cannot
 * contaminate the other. The active runtime-storage adapter owns the actual device
 * persistence implementation; this isolation logic remains platform-neutral.
 */
export function isolateDevelopmentBrowserStorage() {
  if (!import.meta.env.DEV) return;

  try {
    const previousMode = readRuntimeValue(RUNTIME_MODE_STORAGE_KEY);
    if (previousMode === firebaseRuntimeMode) return;

    const storage = getRuntimeStorage();
    const keysToRemove = storage.getAllKeys().filter((key) => {
      if (PRESERVED_LOCAL_KEYS.has(key)) return false;
      return key.startsWith('inkbound_') || key.startsWith('bookhaven_');
    });

    keysToRemove.forEach((key) => storage.removeItem(key));
    writeRuntimeValue(RUNTIME_MODE_STORAGE_KEY, firebaseRuntimeMode);

    if (keysToRemove.length > 0) {
      console.info(
        `Inkbound DEV: cleared ${keysToRemove.length} account cache entr${keysToRemove.length === 1 ? 'y' : 'ies'} while switching to ${firebaseRuntimeMode} Firebase mode.`,
      );
    }
  } catch (error) {
    console.warn('Inkbound could not isolate development runtime storage.', error);
  }
}
