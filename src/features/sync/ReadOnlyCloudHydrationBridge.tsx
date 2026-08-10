import React, { useEffect } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  type DocumentData,
  type QuerySnapshot,
} from 'firebase/firestore';
import type { ReadingSession, UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db, readDb } from '../../lib/firebase';
import { notifyCloudDataUpdated } from './cloudSyncEvents';

const BOOKS_KEY = 'inkbound_books';
const SESSIONS_KEY = 'inkbound_sessions';
const PROFILE_KEY = 'inkbound_reader_profile';
const OWNER_UID_KEY = 'inkbound_local_data_owner_uid';

interface CloudRecord<T> {
  data: T;
}

interface ReaderProfile {
  displayName?: string;
  email?: string;
  favoriteQuote?: string;
  bio?: string;
  avatarImage?: string;
  bannerImage?: string;
}

function safeParse<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

function mergeById<T extends { id: string }>(localItems: T[], cloudItems: T[]): T[] {
  const merged = new Map(localItems.map((item) => [item.id, item]));
  cloudItems.forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values());
}

/**
 * Protected localhost mode intentionally disables browser-side production writes.
 * It must not disable account restoration. This bridge reads the signed-in user's
 * cloud library/profile on a second computer while leaving all write-capable sync
 * code disabled. Production uses CloudPersistenceBridge instead.
 */
export const ReadOnlyCloudHydrationBridge: React.FC = () => {
  const sync = useAccountSync();

  useEffect(() => {
    // `db` is available in production (or an explicit live-write dev session), so
    // the normal bidirectional bridge owns hydration there.
    if (!sync.user || !readDb || db) return undefined;

    const uid = sync.user.uid;
    let disposed = false;
    const unsubscribers: Array<() => void> = [];

    const hydrate = async () => {
      const previousOwnerUid = localStorage.getItem(OWNER_UID_KEY);
      const sameAccount = !previousOwnerUid || previousOwnerUid === uid;
      const localBooks = sameAccount ? safeParse<UserBookRecord[]>(BOOKS_KEY, []) : [];
      const localSessions = sameAccount ? safeParse<ReadingSession[]>(SESSIONS_KEY, []) : [];

      const booksRef = collection(readDb, 'users', uid, 'books');
      const sessionsRef = collection(readDb, 'users', uid, 'sessions');
      const profileRef = doc(readDb, 'users', uid, 'profile', 'current');

      const [bookSnapshot, sessionSnapshot, profileSnapshot] = await Promise.all([
        getDocs(booksRef),
        getDocs(sessionsRef),
        getDoc(profileRef),
      ]);
      if (disposed) return;

      const cloudBooks = bookSnapshot.docs
        .map((item) => (item.data() as CloudRecord<UserBookRecord>).data)
        .filter(Boolean);
      const cloudSessions = sessionSnapshot.docs
        .map((item) => (item.data() as CloudRecord<ReadingSession>).data)
        .filter(Boolean);

      const nextBooks = sameAccount ? mergeById(localBooks, cloudBooks) : cloudBooks;
      const nextSessions = sameAccount ? mergeById(localSessions, cloudSessions) : cloudSessions;

      localStorage.setItem(BOOKS_KEY, JSON.stringify(nextBooks));
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(nextSessions));

      if (profileSnapshot.exists()) {
        const cloudProfile = (profileSnapshot.data() as CloudRecord<ReaderProfile>).data;
        if (cloudProfile) localStorage.setItem(PROFILE_KEY, JSON.stringify(cloudProfile));
      } else if (!sameAccount) {
        localStorage.removeItem(PROFILE_KEY);
      }

      localStorage.setItem(OWNER_UID_KEY, uid);
      notifyCloudDataUpdated([BOOKS_KEY, SESSIONS_KEY, PROFILE_KEY]);

      const applyCollectionSnapshot = <T extends { id: string }>(
        storageKey: 'inkbound_books' | 'inkbound_sessions',
        snapshot: QuerySnapshot<DocumentData>,
      ) => {
        const cloudItems = snapshot.docs
          .map((item) => (item.data() as CloudRecord<T>).data)
          .filter(Boolean);
        const current = safeParse<T[]>(storageKey, []);
        localStorage.setItem(storageKey, JSON.stringify(mergeById(current, cloudItems)));
        notifyCloudDataUpdated([storageKey]);
      };

      unsubscribers.push(
        onSnapshot(booksRef, (snapshot) => applyCollectionSnapshot<UserBookRecord>(BOOKS_KEY, snapshot)),
        onSnapshot(sessionsRef, (snapshot) => applyCollectionSnapshot<ReadingSession>(SESSIONS_KEY, snapshot)),
        onSnapshot(profileRef, (snapshot) => {
          if (!snapshot.exists()) return;
          const cloudProfile = (snapshot.data() as CloudRecord<ReaderProfile>).data;
          if (!cloudProfile) return;
          localStorage.setItem(PROFILE_KEY, JSON.stringify(cloudProfile));
          notifyCloudDataUpdated([PROFILE_KEY]);
        }),
      );
    };

    void hydrate().catch((error) => {
      console.warn('Inkbound could not restore cloud data in protected development mode.', error);
    });

    return () => {
      disposed = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [sync.user?.uid]);

  return null;
};
