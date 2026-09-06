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

function hasLocalLibrary(): boolean {
  try {
    const raw = getRuntimeStorage().getItem(BOOKS_KEY);
    if (!raw) return false;
    const trimmed = raw.trim();
    return trimmed.startsWith('[') && trimmed !== '[]';
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
 * Restores an empty/new device exactly once without installing collection
 * listeners. Existing devices receive a short grace period so IndexedDB/browser
 * storage can restore the local working copy before Inkbound considers a paid
 * Firestore collection read.
 *
 * Once any local library exists AdaptiveCloudPersistenceBridge immediately moves
 * to CostSafeCloudPersistenceBridge, where ordinary navigation and edits do not
 * reread the full Firestore library.
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
      if (hasLocalLibrary()) {
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

        const localBooks = readJson<UserBookRecord[]>(BOOKS_KEY, []);
        const localSessions = readJson<ReadingSession[]>(SESSIONS_KEY, []);
        writeJson(BOOKS_KEY, mergeById(localBooks, cloudBooks));
        writeJson(SESSIONS_KEY, mergeById(localSessions, cloudSessions));

        if (profileSnapshot.exists()) {
          const cloudProfile = (profileSnapshot.data() as CloudRecord<ReaderProfile>).data;
          if (cloudProfile) writeJson(PROFILE_KEY, cloudProfile);
        }

        getRuntimeStorage().setItem(OWNER_UID_KEY, uid);
        notifyCloudDataUpdated([BOOKS_KEY, SESSIONS_KEY, PROFILE_KEY]);
      } catch (error) {
        console.warn('Inkbound one-time cloud restore could not complete; opening the local working copy.', error);
        if (!disposed) openFromLocal();
      }
    };

    if (hasLocalLibrary()) {
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
