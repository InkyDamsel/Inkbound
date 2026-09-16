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
 *
 * Large libraries can contain tens of thousands of records. Normalization is
 * maintenance work, not startup-critical work, so coalesce requests and run the
 * pass only when the main thread is idle (with a bounded timeout fallback).
 */
export const CanonicalLibraryNormalizationBridge = () => {
  useEffect(() => {
    let cancelled = false;
    let scheduled = false;
    let idleId: number | undefined;
    let timerId: number | undefined;

    const run = () => {
      scheduled = false;
      idleId = undefined;
      timerId = undefined;
      if (!cancelled) normalizeStoredLibrary();
    };

    const scheduleNormalization = () => {
      if (cancelled || scheduled) return;
      scheduled = true;

      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(run, { timeout: 2500 });
        return;
      }

      timerId = window.setTimeout(run, 750);
    };

    scheduleNormalization();
    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, scheduleNormalization);

    return () => {
      cancelled = true;
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, scheduleNormalization);
      if (idleId !== undefined && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, []);

  return null;
};
