import React, { useEffect } from 'react';
import { deleteDoc, doc, getDoc } from 'firebase/firestore';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import { readRuntimeJson, removeRuntimeValue } from '../../platform/runtimeStorage';
import type { UserBookRecord } from '../../types';
import {
  migrateSeriesOverridesToCanonicalBooks,
  readSeriesOverrides,
  SERIES_OVERRIDES_STORAGE_KEY,
  type SeriesOverride,
  type SeriesOverrides,
} from '../series/seriesOverrides';
import { replaceCanonicalLibrary } from '../library/libraryMutations';
import { ACCOUNT_DATA_STORAGE_KEYS, SYNC_STORAGE_KEYS } from './storageKeys';

interface CloudAuxiliaryRecord {
  data?: unknown;
}

const asOverrides = (value: unknown): SeriesOverrides => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as SeriesOverrides;
};

const mergeOverrideSources = (...sources: SeriesOverrides[]): SeriesOverrides => {
  const merged: SeriesOverrides = {};
  sources.forEach((source) => {
    Object.entries(source).forEach(([id, candidate]) => {
      const current = merged[id];
      if (!current) {
        merged[id] = candidate;
        return;
      }
      const currentTime = Date.parse(current.updatedAt || current.createdAt || '') || 0;
      const candidateTime = Date.parse(candidate.updatedAt || candidate.createdAt || '') || 0;
      if (candidateTime >= currentTime) merged[id] = candidate;
    });
  });
  return merged;
};

const referencedBookIds = (overrides: SeriesOverrides) =>
  new Set(Object.values(overrides).flatMap((override: SeriesOverride) =>
    override.books.map((entry) => entry.bookId)));

export const LegacySeriesOverrideMigrationBridge: React.FC = () => {
  const { user } = useAccountSync();

  useEffect(() => {
    if (!user || !db) return;
    let disposed = false;

    const migrate = async () => {
      const uid = user.uid;
      const localBooks = readRuntimeJson<UserBookRecord[]>(SYNC_STORAGE_KEYS.books, []);
      const localOverrides = readSeriesOverrides();

      const canonicalRef = doc(db!, 'users', uid, 'auxiliary', 'seriesOverrides');
      const legacyRef = doc(db!, 'users', uid, 'auxiliary', ACCOUNT_DATA_STORAGE_KEYS.seriesOverrides);
      const [canonicalSnapshot, legacySnapshot] = await Promise.all([
        getDoc(canonicalRef),
        getDoc(legacyRef),
      ]);
      if (disposed) return;

      const canonicalOverrides = canonicalSnapshot.exists()
        ? asOverrides((canonicalSnapshot.data() as CloudAuxiliaryRecord).data)
        : {};
      const legacyOverrides = legacySnapshot.exists()
        ? asOverrides((legacySnapshot.data() as CloudAuxiliaryRecord).data)
        : {};

      const combined = mergeOverrideSources(legacyOverrides, canonicalOverrides, localOverrides);
      const referenced = referencedBookIds(combined);

      if (referenced.size === 0) {
        removeRuntimeValue(SERIES_OVERRIDES_STORAGE_KEY);
        await Promise.allSettled([
          canonicalSnapshot.exists() ? deleteDoc(canonicalRef) : Promise.resolve(),
          legacySnapshot.exists() ? deleteDoc(legacyRef) : Promise.resolve(),
        ]);
        return;
      }

      const migrated = migrateSeriesOverridesToCanonicalBooks(localBooks, combined);
      if (migrated.migratedBookIds.length > 0) {
        replaceCanonicalLibrary(migrated.books);
      }

      const migratedIds = new Set(migrated.migratedBookIds);
      const allReferencedBooksResolved = [...referenced].every((bookId) => migratedIds.has(bookId));

      if (!allReferencedBooksResolved) {
        // The core library may still be undergoing repair. Keep the legacy cloud
        // record migration-only and retry on a later launch rather than dropping
        // reader-authored series intent that cannot yet be attached safely.
        return;
      }

      removeRuntimeValue(SERIES_OVERRIDES_STORAGE_KEY);
      await Promise.allSettled([
        canonicalSnapshot.exists() ? deleteDoc(canonicalRef) : Promise.resolve(),
        legacySnapshot.exists() ? deleteDoc(legacyRef) : Promise.resolve(),
      ]);
    };

    void migrate().catch((error) => {
      console.warn('Inkbound could not finish legacy series migration yet.', error);
    });

    return () => {
      disposed = true;
    };
  }, [user?.uid]);

  return null;
};
