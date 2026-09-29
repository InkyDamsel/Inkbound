import React, { useEffect } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import type { ReadingSession, UserBookRecord } from '../../types';
import { mergeIncomingBookLoanState } from '../ownership/bookOwnership';
import { mergeIncomingBookQuoteState } from '../reading/bookQuotePersistence';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import {
  flushLargeBrowserStorage,
  hydrateLargeBrowserStorage,
} from '../../platform/largeBrowserStorage';
import { subscribeToRuntimeResume } from '../../platform/runtimeLifecycle';
import { isNativeRuntime } from '../../platform/runtimePlatform';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import { notifyCloudDataUpdated } from './cloudSyncEvents';
import {
  ACCOUNT_LIBRARY_MIGRATION_VERSION,
  accountLibraryMigrationVersionKey,
  crossDeviceCursorKey,
  FULL_RECONCILIATION_VERSION,
  fullReconciliationVersionKey,
  SYNC_STORAGE_KEYS,
} from './storageKeys';

const BOOKS_KEY = SYNC_STORAGE_KEYS.books;
const SESSIONS_KEY = SYNC_STORAGE_KEYS.sessions;
const PROFILE_KEY = SYNC_STORAGE_KEYS.profile;
const OWNER_UID_KEY = SYNC_STORAGE_KEYS.localOwnerUid;
const HYDRATION_REQUIRED_UID_KEY = SYNC_STORAGE_KEYS.hydrationRequiredOwnerUid;
const LOCAL_HYDRATION_GRACE_MS = 1800;

interface CloudRecord<T> {
  data: T;
  updatedAt?: { toMillis(): number };
}
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
    if (storage.getItem(HYDRATION_REQUIRED_UID_KEY) === uid) return false;
    // A sync-engine migration can invalidate an otherwise "established" local
    // cache. Until this device has completed the current full reconciliation,
    // cloud remains the authoritative repair source for existing account data.
    if (storage.getItem(fullReconciliationVersionKey(uid)) !== FULL_RECONCILIATION_VERSION) return false;

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

function mergeBooksById(localItems: UserBookRecord[], cloudItems: UserBookRecord[]): UserBookRecord[] {
  const merged = new Map(localItems.map((item) => [item.id, item]));
  cloudItems.forEach((item) => {
    const local = merged.get(item.id);
    const withQuotes = mergeIncomingBookQuoteState(local, item);
    merged.set(item.id, mergeIncomingBookLoanState(local, withQuotes));
  });
  return [...merged.values()];
}

function newestSnapshotUpdateMillis(
  documents: Array<{ data(): unknown }>,
  initial = 0,
): number {
  return documents.reduce((newest, item) => {
    const updatedAt = (item.data() as CloudRecord<unknown>).updatedAt?.toMillis() ?? 0;
    return Math.max(newest, updatedAt);
  }, initial);
}

/**
 * Restores a genuinely new device exactly once without installing collection
 * listeners. Established local working copies, including intentionally empty
 * libraries, stay local-first.
 *
 * Account ownership is checked before local records are merged. A switched
 * account is explicitly marked as requiring hydration so local edits made while
 * offline can be preserved and merged when connectivity returns instead of being
 * mistaken for a fully hydrated library.
 *
 * Android keeps the normal Build 27.6 startup/auth path. Only after a signed-in
 * account actually needs first-device hydration do we restore/install the same
 * canonical large-library storage bridge used by web. This avoids WebView
 * localStorage quota failures for very large libraries without adding a second
 * Android persistence owner or gating authentication on IndexedDB startup.
 */
export const OneShotCloudHydrationBridge: React.FC = () => {
  const { user } = useAccountSync();

  useEffect(() => {
    if (!user || !db) return undefined;
    const uid = user.uid;
    let disposed = false;
    let timer: number | undefined;
    let hydrationRunning = false;

    const openFromLocal = () => {
      getRuntimeStorage().setItem(OWNER_UID_KEY, uid);
      notifyCloudDataUpdated([BOOKS_KEY, SESSIONS_KEY, PROFILE_KEY]);
    };

    const hydrate = async () => {
      if (disposed || hydrationRunning || !navigator.onLine) return;

      hydrationRunning = true;
      try {
        // A large Android library may have been moved out of raw localStorage on
        // a previous run. Restore that canonical IndexedDB-backed value before
        // deciding that this device needs another full cloud download.
        if (isNativeRuntime()) {
          await hydrateLargeBrowserStorage();
          if (disposed) return;
        }

        if (hasEstablishedLocalWorkingCopy(uid)) {
          openFromLocal();
          return;
        }

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
        writeJson(BOOKS_KEY, mergeBooksById(localBooks, cloudBooks));
        writeJson(SESSIONS_KEY, mergeById(localSessions, cloudSessions));

        if (profileSnapshot.exists()) {
          const cloudProfile = (profileSnapshot.data() as CloudRecord<ReaderProfile>).data;
          if (cloudProfile) writeJson(PROFILE_KEY, cloudProfile);
          else if (!sameAccountLocalData) storage.removeItem(PROFILE_KEY);
        } else if (!sameAccountLocalData) {
          storage.removeItem(PROFILE_KEY);
        }

        // If the books payload crossed the large-storage threshold, wait until
        // the IndexedDB write is durable before publishing the owner marker. A
        // device must never claim hydration completed while its canonical library
        // is still only an in-memory/cache write.
        if (isNativeRuntime()) {
          await flushLargeBrowserStorage();
          if (disposed) return;
        }

        // Delta sync starts immediately after hydration. Seed its cursor from the
        // newest server timestamp actually present in this full snapshot so it
        // does not reread a very large library from the beginning. Reduce rather
        // than spreading tens of thousands of timestamps into Math.max; large
        // libraries can exceed JavaScript's function-argument limit.
        let hydrationCursorMillis = newestSnapshotUpdateMillis(bookSnapshot.docs);
        hydrationCursorMillis = newestSnapshotUpdateMillis(sessionSnapshot.docs, hydrationCursorMillis);
        if (profileSnapshot.exists()) {
          hydrationCursorMillis = Math.max(
            hydrationCursorMillis,
            (profileSnapshot.data() as CloudRecord<unknown>).updatedAt?.toMillis() ?? 0,
          );
        }
        if (hydrationCursorMillis > 0) {
          storage.setItem(crossDeviceCursorKey(uid), String(hydrationCursorMillis));
        }

        storage.setItem(OWNER_UID_KEY, uid);
        // A new/returning device that built its working copy directly from the
        // verified cloud snapshot does not need a local-to-cloud migration.
        storage.setItem(accountLibraryMigrationVersionKey(uid), ACCOUNT_LIBRARY_MIGRATION_VERSION);
        storage.setItem(fullReconciliationVersionKey(uid), FULL_RECONCILIATION_VERSION);
        if (storage.getItem(HYDRATION_REQUIRED_UID_KEY) === uid) {
          storage.removeItem(HYDRATION_REQUIRED_UID_KEY);
        }
        notifyCloudDataUpdated([BOOKS_KEY, SESSIONS_KEY, PROFILE_KEY]);
      } catch (error) {
        console.warn('Inkbound one-time cloud restore could not complete; it will retry when connectivity returns.', error);
        if (!disposed && hasEstablishedLocalWorkingCopy(uid)) openFromLocal();
      } finally {
        hydrationRunning = false;
      }
    };

    const retryHydration = () => {
      if (disposed || hasEstablishedLocalWorkingCopy(uid)) return;
      void hydrate();
    };

    if (hasEstablishedLocalWorkingCopy(uid)) {
      openFromLocal();
    } else {
      timer = window.setTimeout(() => {
        timer = undefined;
        retryHydration();
      }, LOCAL_HYDRATION_GRACE_MS);
    }

    const unsubscribeRuntimeResume = subscribeToRuntimeResume(retryHydration);

    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      unsubscribeRuntimeResume();
    };
  }, [user?.uid]);

  return null;
};
