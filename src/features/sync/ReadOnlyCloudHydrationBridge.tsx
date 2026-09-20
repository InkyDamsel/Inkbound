import React, { useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import type { UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db, readDb } from '../../lib/firebase';
import {
  readRuntimeValue,
  writeRuntimeJson,
  writeRuntimeValue,
} from '../../platform/runtimeStorage';
import { notifyCloudDataUpdated } from './cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from './storageKeys';

const BOOKS_KEY = SYNC_STORAGE_KEYS.books;
const OWNER_UID_KEY = SYNC_STORAGE_KEYS.localOwnerUid;
const PROTECTED_DEV_HYDRATION_VERSION = '1';
const protectedDevHydrationKey = (uid: string) =>
  `inkbound_protected_dev_books_hydration_${uid}_v1`;

interface CloudRecord<T> {
  data: T;
}

function hasLocalBooksForUser(uid: string): boolean {
  const ownerUid = readRuntimeValue(OWNER_UID_KEY);
  if (ownerUid && ownerUid !== uid) return false;

  const raw = readRuntimeValue(BOOKS_KEY);
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

/**
 * Protected development mode uses production Firebase Auth but must remain
 * read-only against production Firestore.
 *
 * To make account-backed features such as Community testable on localhost, this
 * bridge performs one bounded books-only hydration when the protected cache has
 * no established library. It installs no listeners, performs no writes, does not
 * fetch sessions or auxiliary account collections, and records a local marker so
 * routine dev reloads do not repeatedly bill the same production reads.
 */
export const ReadOnlyCloudHydrationBridge: React.FC = () => {
  const sync = useAccountSync();

  useEffect(() => {
    if (!sync.user || !readDb || db) return undefined;

    const uid = sync.user.uid;
    let disposed = false;
    const hydrationKey = protectedDevHydrationKey(uid);

    const useLocalCopy = () => {
      writeRuntimeValue(OWNER_UID_KEY, uid);
      notifyCloudDataUpdated([BOOKS_KEY]);
    };

    if (hasLocalBooksForUser(uid)) {
      useLocalCopy();
      return undefined;
    }

    if (readRuntimeValue(hydrationKey) === PROTECTED_DEV_HYDRATION_VERSION) {
      useLocalCopy();
      return undefined;
    }

    const hydrateBooksOnce = async () => {
      try {
        const snapshot = await getDocs(collection(readDb!, 'users', uid, 'books'));
        if (disposed) return;

        const books = snapshot.docs
          .map((item) => (item.data() as CloudRecord<UserBookRecord>).data)
          .filter(Boolean);

        writeRuntimeJson(BOOKS_KEY, books);
        writeRuntimeValue(OWNER_UID_KEY, uid);
        writeRuntimeValue(hydrationKey, PROTECTED_DEV_HYDRATION_VERSION);
        notifyCloudDataUpdated([BOOKS_KEY]);

        console.info(
          `Inkbound protected DEV mode: hydrated ${books.length} books once for local read-only testing. Production Firestore writes, live listeners, sessions, auxiliary collections, and Cloud Functions remain blocked.`,
        );
      } catch (error) {
        console.warn(
          'Inkbound protected DEV mode could not complete its one-time read-only library hydration.',
          error,
        );
      }
    };

    void hydrateBooksOnce();

    return () => {
      disposed = true;
    };
  }, [sync.user?.uid]);

  return null;
};
