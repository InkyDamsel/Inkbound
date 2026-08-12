import { firebaseRuntimeMode } from '../../lib/firebase';

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
 * localhost used to double as Inkbound's production-connected development origin.
 * Once the Firebase emulators were introduced, those old browser caches could leak
 * production-looking books/import history/profile data into an otherwise empty DEV
 * account. Clear account-owned local caches whenever a developer changes Firebase
 * runtime mode so DEV and live-cloud verification cannot contaminate one another.
 *
 * Production builds are intentionally untouched: deployed production has its own
 * browser origin and remains free to use its normal persistent cache.
 */
export function isolateDevelopmentBrowserStorage() {
  if (!import.meta.env.DEV) return;

  try {
    const previousMode = localStorage.getItem(RUNTIME_MODE_STORAGE_KEY);
    if (previousMode === firebaseRuntimeMode) return;

    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || PRESERVED_LOCAL_KEYS.has(key)) continue;
      if (key.startsWith('inkbound_') || key.startsWith('bookhaven_')) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => localStorage.removeItem(key));
    localStorage.setItem(RUNTIME_MODE_STORAGE_KEY, firebaseRuntimeMode);

    if (keysToRemove.length > 0) {
      console.info(
        `Inkbound DEV: cleared ${keysToRemove.length} account cache entr${keysToRemove.length === 1 ? 'y' : 'ies'} while switching to ${firebaseRuntimeMode} Firebase mode.`,
      );
    }
  } catch (error) {
    console.warn('Inkbound could not isolate development browser storage.', error);
  }
}
