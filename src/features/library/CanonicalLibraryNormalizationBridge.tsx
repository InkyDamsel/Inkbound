import { useEffect } from 'react';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import { INKBOUND_CLOUD_DATA_EVENT } from '../sync/cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from '../sync/storageKeys';
import { replaceCanonicalLibrary } from './libraryMutations';
import { normalizeCanonicalLibraryRecords } from './libraryNormalization';
import type { UserBookRecord } from '../../types';

const normalizeStoredLibrary = () => {
  try {
    const raw = getRuntimeStorage().getItem(SYNC_STORAGE_KEYS.books);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    const { books, changed } = normalizeCanonicalLibraryRecords(parsed as UserBookRecord[]);
    if (changed) replaceCanonicalLibrary(books);
  } catch (error) {
    console.warn('Inkbound skipped a library normalization pass.', error);
  }
};

/**
 * Applies narrow legacy/import corrections to the canonical library itself.
 * Feature screens never need to invent a competing view of ownership.
 */
export const CanonicalLibraryNormalizationBridge = () => {
  useEffect(() => {
    normalizeStoredLibrary();
    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, normalizeStoredLibrary);
    return () => window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, normalizeStoredLibrary);
  }, []);

  return null;
};
