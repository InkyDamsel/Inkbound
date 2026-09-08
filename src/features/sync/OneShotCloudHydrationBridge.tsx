import React, { useEffect } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import type { ReadingSession, UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import { notifyCloudDataUpdated } from './cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from './storageKeys';

const BOOKS_KEY = SYNC_STORAGE_KEYS.books;
const SESSIONS_KEY = SYNC_STORAGE_KEYS.sessions;
const PROFILE_KEY = SYNC_STORAGE_KEYS.profile;
const OWNER_UID_KEY = SYNC_STORAGE_KEYS.localOwnerUid;
const LOCAL_HYDRATION_GRACE_MS = 1800;

interface CloudRecord<T> { data: T }
interface ReaderProfile {
  displayName?: string;
  email?: string;
  favoriteQuote?: string;
  bio?: string;
  avatarImage?: string;
  bannerImage?: string;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = getRuntimeStorage().getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  getRuntimeStorage().setItem(key, JSON.stringify(value));
}

function hasEstablishedLocalWorkingCopy(uid: string): boolean {
  try {
    const storage = getRuntimeStorage();
    const raw = storage.getItem(BOOKS_KEY);
    if (!raw) return false;
    const trimmed = raw.trim();
    if (!trimmed.startsWith('[')) return false;

    const ownerUid = storage.getItem(OWNER_UID_KEY);
    if (ownerUid) return ownerUid === uid;
    return trimmed !== '[]';
  } catch {
    return false;
  }
}

function mergeById<T extends { id: string }>(localItems: T[], cloudItems: T[]): T[] {
  const merged = new Map(localItems.map((item) => [item.id, item]));
  cloudItems.forEach((item) => merged.set(item.id, item));
  return [...merged.values()];
}

/**
 * Restores a genuinely new device exactly once without installing collection
 * listeners. Established local working copies, including intentionally empty
 * libraries, stay local-first.
 *
 * Account ownership is checked before local records are merged. This prevents a
 * previous reader's cached books, sessions, or profile from leaking into a newly
 * signed-in account while the other account-cleanup bridges are still starting.
 */
export const OneShotCloudHydrationBridge: React.FC = () => {
  const { user } = useAccountSync();

  useEffect(() => {
    if (!user || !db) return undefined;
    const uid = user.uid;
    let disposed = false;
    let timer: number | undefined;

    const openFromLocal = () => {
      getRuntimeStorage().setItem(OWNER_UID_KEY, uid);
      notifyCloudDataUpdated([BOOKS_KEY, SESSIONS_KEY, PROFILE_KEY]);
    };

    const hydrate = async () => {
      if (disposed) return;
      if (hasEstablishedLocalWorkingCopy(uid)) {
        openFromLocal();
        return;
      }

      try {
        const booksRef = collection(db!, 'users', uid, 'books');
        const sessionsRef = collection(db!, 'users', uid, 'sessions');
        const profileRef = doc(db!, 'users', uid, 'profile', 'current');

        const [bookSnapshot, sessionSnapshot, profileSnapshot] = await Promise.all([
          getDocs(booksRef),
          getDocs(sessionsRef),
          getDoc(profileRef),
        ]);
        if (disposed) return;

        const cloudBooks = bookSnapshot.docs.map((item) => (item.data() as CloudRecord<UserBookRecord>).data).filter(Boolean);
        const cloudSessions = sessionSnapshot.docs.map((item) => (item.data() as CloudRecord<ReadingSession>).data).filter(Boolean);
        const storage = getRuntimeStorage();
        const previousOwnerUid = storage.getItem(OWNER_UID_KEY);
        const sameAccountLocalData = !previousOwnerUid || previousOwnerUid === uid;

        const localBooks = sameAccountLocalData ? readJson<UserBookRecord[]>(BOOKS_KEY, []) : [];
        const localSessions = sameAccountLocalData ? readJson<ReadingSession[]>(SESSIONS_KEY, []) : [];
        writeJson(BOOKS_KEY, mergeById(localBooks, cloudBooks));
        writeJson(SESSIONS_KEY, mergeById(localSessions, cloudSessions));

        if (profileSnapshot.exists()) {
          const cloudProfile = (profileSnapshot.data() as CloudRecord<ReaderProfile>).data;
          if (cloudProfile) writeJson(PROFILE_KEY, cloudProfile);
          else if (!sameAccountLocalData) storage.removeItem(PROFILE_KEY);
        } else if (!sameAccountLocalData) {
          storage.removeItem(PROFILE_KEY);
        }

        storage.setItem(OWNER_UID_KEY, uid);
        notifyCloudDataUpdated([BOOKS_KEY, SESSIONS_KEY, PROFILE_KEY]);
      } catch (error) {
        console.warn('Inkbound one-time cloud restore could not complete; opening the local working copy.', error);
        if (!disposed && hasEstablishedLocalWorkingCopy(uid)) openFromLocal();
      }
    };

    if (hasEstablishedLocalWorkingCopy(uid)) {
      openFromLocal();
    } else {
      timer = window.setTimeout(() => {
        timer = undefined;
        void hydrate();
      }, LOCAL_HYDRATION_GRACE_MS);
    }

    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [user?.uid]);

  return null;
};
