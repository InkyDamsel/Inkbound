import React, { useEffect, useRef } from 'react';
import type { UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { prepareBookCoverImage } from '../../platform/prepareBookCoverImage';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import {
import { replaceCanonicalLibrary } from '../library/libraryMutations';
import {
  getCloudDataRevision,
  INKBOUND_CLOUD_DATA_EVENT,
  notifyCloudDataUpdated,
  notifyLocalDataChanged,
} from './cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from './storageKeys';

const BOOKS_STORAGE_KEY = SYNC_STORAGE_KEYS.books;
const LOCAL_DATA_OWNER_UID_KEY = SYNC_STORAGE_KEYS.localOwnerUid;
const LEGACY_COVER_PREFIX = 'data:image/';

const readBooks = (): UserBookRecord[] => {
  try {
    const raw = getRuntimeStorage().getItem(BOOKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UserBookRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const dataUrlToFile = async (dataUrl: string, editionId: string) => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const type = blob.type || 'image/jpeg';
  const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return new File([blob], `legacy-${editionId}.${extension}`, { type });
};

/**
 * One-way migration for older manually uploaded covers that were embedded as
 * data URLs inside Edition.coverUrl. New signed-in uploads already go directly
 * to Firebase Storage through prepareBookCoverImage().
 *
 * Migration waits for the current authenticated account's cloud hydration before
 * reading local book data. This prevents a stale cache from a previously signed-
 * in account from ever being uploaded into the new account's Storage namespace.
 * Offline/failing migrations keep the original cover intact and retry later.
 */
export const LegacyBookCoverMigrationBridge: React.FC = () => {
  const { user } = useAccountSync();
  const running = useRef(false);

  useEffect(() => {
    if (!user) return undefined;
    let disposed = false;

    const currentAccountLibraryIsVerified = () =>
      getCloudDataRevision() > 0
      && getRuntimeStorage().getItem(LOCAL_DATA_OWNER_UID_KEY) === user.uid;

    const migrate = async () => {
      if (
        disposed
        || running.current
        || !navigator.onLine
        || !currentAccountLibraryIsVerified()
      ) return;

      const books = readBooks();
      const candidates = books.flatMap((book) =>
        book.editions
          .filter((edition) => edition.coverUrl?.startsWith(LEGACY_COVER_PREFIX))
          .map((edition) => ({ bookId: book.id, editionId: edition.id, coverUrl: edition.coverUrl! })),
      );
      if (candidates.length === 0) return;

      running.current = true;
      try {
        const replacements = new Map<string, string>();

        // Keep migration deliberately sequential. A large imported library can
        // contain many legacy covers and should not spike phone memory/network.
        for (const candidate of candidates) {
          if (disposed || !navigator.onLine || !currentAccountLibraryIsVerified()) break;
          try {
            const file = await dataUrlToFile(candidate.coverUrl, candidate.editionId);
            const uploadedUrl = await prepareBookCoverImage(file);
            if (!uploadedUrl.startsWith('data:image/')) {
              replacements.set(`${candidate.bookId}:${candidate.editionId}`, uploadedUrl);
            }
          } catch {
            // Preserve the embedded image and retry on the next online/cloud
            // refresh instead of partially damaging the canonical book record.
          }
        }

        if (disposed || replacements.size === 0 || !currentAccountLibraryIsVerified()) return;
        const currentBooks = readBooks();
        let changed = false;
        const nextBooks = currentBooks.map((book) => ({
          ...book,
          editions: book.editions.map((edition) => {
            const replacement = replacements.get(`${book.id}:${edition.id}`);
            if (!replacement || !edition.coverUrl?.startsWith(LEGACY_COVER_PREFIX)) return edition;
            changed = true;
            return { ...edition, coverUrl: replacement };
          }),
        }));

        if (!changed) return;
        replaceCanonicalLibrary(nextBooks);
      } finally {
        running.current = false;
      }
    };

    const retry = () => void migrate();
    if (currentAccountLibraryIsVerified()) void migrate();
    window.addEventListener('online', retry);
    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, retry);
    return () => {
      disposed = true;
      window.removeEventListener('online', retry);
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, retry);
    };
  }, [user?.uid]);

  return null;
};
