import React, { useEffect } from 'react';
import type { UserBookRecord } from '../../types';
import {
  INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT,
  notifyRuntimeStorageChanged,
  readRuntimeJson,
  writeRuntimeJson,
} from '../../platform/runtimeStorage';
import {
  migrateSeriesOverridesToCanonicalBooks,
  readSeriesOverrides,
  SERIES_OVERRIDES_STORAGE_KEY,
  type SeriesOverrides,
} from '../series/seriesOverrides';
import { SYNC_STORAGE_KEYS } from './storageKeys';

const BOOKS_KEY = SYNC_STORAGE_KEYS.books;

const remainingOverrides = (
  overrides: SeriesOverrides,
  migratedBookIds: Set<string>,
): SeriesOverrides => Object.fromEntries(
  Object.entries(overrides).flatMap(([id, override]) => {
    const books = override.books.filter((entry) => !migratedBookIds.has(entry.bookId));
    return books.length ? [[id, { ...override, books }]] : [];
  }),
);

/**
 * Migrates the retired manual series grouping store into canonical book records.
 *
 * The bridge also listens for auxiliary-account hydration because an older cloud
 * account may deliver seriesOverrides after the core library has already opened.
 * Entries whose books are not present yet remain queued in the legacy store until
 * their canonical book is available.
 */
export const LegacySeriesOverridesMigrationBridge: React.FC = () => {
  useEffect(() => {
    const migrate = () => {
      const overrides = readSeriesOverrides();
      if (Object.keys(overrides).length === 0) return;

      const books = readRuntimeJson<UserBookRecord[]>(BOOKS_KEY, []);
      if (books.length === 0) return;

      const result = migrateSeriesOverridesToCanonicalBooks(books, overrides);
      if (result.migratedBookIds.length === 0) return;

      writeRuntimeJson(BOOKS_KEY, result.books);
      const migratedIds = new Set(result.migratedBookIds);
      writeRuntimeJson(SERIES_OVERRIDES_STORAGE_KEY, remainingOverrides(overrides, migratedIds));

      // App state and mounted legacy hooks may otherwise keep stale in-memory
      // values after this storage-level migration.
      notifyRuntimeStorageChanged(BOOKS_KEY);
      notifyRuntimeStorageChanged(SERIES_OVERRIDES_STORAGE_KEY);
    };

    migrate();
    const handleRuntimeRefresh = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key === BOOKS_KEY || key === SERIES_OVERRIDES_STORAGE_KEY) migrate();
    };
    window.addEventListener(INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT, handleRuntimeRefresh);
    return () => window.removeEventListener(INKBOUND_RUNTIME_STORAGE_REFRESH_EVENT, handleRuntimeRefresh);
  }, []);

  return null;
};
