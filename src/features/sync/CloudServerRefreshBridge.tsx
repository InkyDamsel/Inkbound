import React, { useEffect, useRef } from 'react';
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { ReadingSession, UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { IMPORT_ENRICHMENT_PAUSED_KEY } from '../import/importHistory';
import { db } from '../../lib/firebase';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import { canReportCloudLibraryHealthy } from './accountLibraryMigration';
import { notifyCloudDataUpdated } from './cloudSyncEvents';
import {
  INKBOUND_FORCE_CLOUD_REFRESH_EVENT,
  publishCloudSyncHealth,
} from './cloudSyncHealth';
import {
  ACCOUNT_LIBRARY_MIGRATION_VERSION,
  accountLibraryMigrationVersionKey,
  SYNC_STORAGE_KEYS,
  syncPendingStateKey,
} from './storageKeys';
import {
  mergeBooksFromServer,
  mergeServerCollectionById,
  type PendingMutation,
} from './cloudServerMergePolicy';

const BOOKS_KEY = SYNC_STORAGE_KEYS.books;
const SESSIONS_KEY = SYNC_STORAGE_KEYS.sessions;
const PROFILE_KEY = SYNC_STORAGE_KEYS.profile;
const LAST_SYNC_STORAGE_KEY = SYNC_STORAGE_KEYS.lastCloudSyncAt;
const LEGACY_AUTOPAUSE_MIGRATION_KEY = 'inkbound_import_enrichment_autopause_cleanup_v1';
const REPAIR_UPLOAD_BATCH_SIZE = 100;

interface CloudRecord<T> {
  data: T;
}

interface PendingSyncState {
  books: Record<string, PendingMutation<UserBookRecord>>;
  sessions: Record<string, PendingMutation<ReadingSession>>;
  profile?: {
    data: Record<string, unknown>;
    clientUpdatedAt: string;
    capturedAfterCloudReconcile?: boolean;
  };
}

interface LibrarySyncManifest {
  status?: 'syncing' | 'complete';
  expectedBookCount?: number;
  uploadedBookCount?: number;
  syncDirection?: 'grow' | 'shrink' | 'unknown';
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

function compactProfileForRuntime(profile: Record<string, unknown>): Record<string, unknown> {
  const compact = { ...profile };
  delete compact.avatarImageData;
  delete compact.bannerImageData;
  delete compact.avatarMediaKey;
  delete compact.bannerMediaKey;
  return compact;
}

/**
 * Full collection reads are reserved for an explicit user/admin recovery-style
 * refresh. Everyday startup and cross-device reconciliation belong to the
 * adaptive one-shot/delta bridges. Keeping those roles separate avoids repeated
 * full-library reads and, more importantly, prevents an intentional empty local
 * library from being "recovered" back into existence while its deletions are
 * still syncing.
 */
export const CloudServerRefreshBridge: React.FC = () => {
  const { user } = useAccountSync();
  const running = useRef(false);

  useEffect(() => {
    if (!user || !db) {
      publishCloudSyncHealth({
        status: 'idle',
        lastSuccessfulSyncAt: null,
        message: user ? 'Your saved library is temporarily unavailable.' : 'Waiting for sign-in.',
      });
      return undefined;
    }

    const uid = user.uid;
    let disposed = false;
    const storage = getRuntimeStorage();

    // Older builds paused metadata enrichment as a module-load side effect. That
    // state did not represent a reader choice, so clear it exactly once after the
    // fixed build opens. Future pause semantics remain untouched after migration.
    if (storage.getItem(LEGACY_AUTOPAUSE_MIGRATION_KEY) !== '1') {
      storage.removeItem(IMPORT_ENRICHMENT_PAUSED_KEY);
      storage.setItem(LEGACY_AUTOPAUSE_MIGRATION_KEY, '1');
    }

    const libraryManifestRef = doc(db, 'users', uid, 'syncState', 'library');

    const pendingState = () => readJson<PendingSyncState>(syncPendingStateKey(uid), {
      books: {},
      sessions: {},
    });

    const repairIncompleteCloudLibrary = async (expected: number, uploaded: number) => {
      if (expected <= 0 || uploaded >= expected) return uploaded;

      const localBooks = readJson<UserBookRecord[]>(BOOKS_KEY, []);
      if (localBooks.length < expected) return uploaded;

      const cloudSnapshot = await getDocs(collection(db!, 'users', uid, 'books'));
      const cloudIds = new Set(cloudSnapshot.docs.map((item) => item.id));
      const missingBooks = localBooks.filter((book) => book?.id && !cloudIds.has(book.id));
      if (missingBooks.length === 0) return cloudSnapshot.size;

      publishCloudSyncHealth({
        status: 'checking',
        lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
        message: `Inkbound found ${missingBooks.length.toLocaleString()} local book${missingBooks.length === 1 ? '' : 's'} missing from your saved account copy. Repairing that upload now…`,
      });

      const clientUpdatedAt = new Date().toISOString();
      for (let index = 0; index < missingBooks.length; index += REPAIR_UPLOAD_BATCH_SIZE) {
        if (disposed) return uploaded;
        const batch = missingBooks.slice(index, index + REPAIR_UPLOAD_BATCH_SIZE);
        const results = await Promise.allSettled(batch.map((book) => setDoc(
          doc(db!, 'users', uid, 'books', book.id),
          {
            data: book,
            updatedAt: serverTimestamp(),
            clientUpdatedAt,
          },
          { merge: true },
        )));

        results.forEach((result) => {
          if (result.status === 'rejected') {
            console.warn('Inkbound manual refresh could not repair one missing book yet.', result.reason);
          }
        });
      }

      const repairedCount = await getCountFromServer(collection(db!, 'users', uid, 'books'));
      return repairedCount.data().count;
    };

    const verifyCloudLibraryComplete = async () => {
      const manifestSnapshot = await getDoc(libraryManifestRef);
      if (!manifestSnapshot.exists()) return { complete: true, expected: 0, uploaded: 0 };

      const manifest = manifestSnapshot.data() as LibrarySyncManifest;
      const expected = Math.max(0, manifest.expectedBookCount ?? 0);
      const countSnapshot = await getCountFromServer(collection(db!, 'users', uid, 'books'));
      let uploaded = countSnapshot.data().count;

      // A shrinking library is only complete when the cloud count reaches the
      // expected count exactly. For a previously-complete non-empty manifest,
      // additional books from another device are safe to read; fewer books are
      // never treated as complete. Expected zero always requires actual zero so a
      // delete-all operation cannot be "verified" while stale books remain.
      let complete = expected === 0
        ? uploaded === 0
        : manifest.status === 'syncing'
          ? uploaded === expected
          : uploaded >= expected;

      // Manual "Try again" is also our recovery escape hatch for older partial
      // growth uploads whose missing records vanished from the durable pending
      // queue. Only attempt this when cloud is below the expected count and the
      // browser still holds at least the full expected local library. We compare
      // document IDs and upload only cloud-missing books, so existing cloud data
      // is never replaced wholesale.
      if (!complete && uploaded < expected) {
        uploaded = await repairIncompleteCloudLibrary(expected, uploaded);
        complete = expected === 0
          ? uploaded === 0
          : manifest.status === 'syncing'
            ? uploaded === expected
            : uploaded >= expected;
      }

      if (complete && manifest.status !== 'complete') {
        await setDoc(libraryManifestRef, {
          status: 'complete',
          expectedBookCount: expected,
          uploadedBookCount: uploaded,
          completedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } else if (!complete) {
        await setDoc(libraryManifestRef, {
          status: 'syncing',
          expectedBookCount: expected,
          uploadedBookCount: uploaded,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      return { complete, expected, uploaded };
    };

    const refreshFromServer = async () => {
      if (running.current || disposed || !navigator.onLine) return;
      running.current = true;
      publishCloudSyncHealth({
        status: 'checking',
        lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
        message: 'Checking for your latest saved books and reading activity…',
      });

      try {
        const syncState = await verifyCloudLibraryComplete();
        if (disposed) return;
        if (!syncState.complete) {
          publishCloudSyncHealth({
            status: 'error',
            lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
            message: `Your cloud library is still finishing its sync (${syncState.uploaded.toLocaleString()} of ${syncState.expected.toLocaleString()} books). Inkbound kept the library already on this device unchanged.`,
          });
          return;
        }

        const [bookSnapshot, sessionSnapshot, profileSnapshot] = await Promise.all([
          getDocs(collection(db!, 'users', uid, 'books')),
          getDocs(collection(db!, 'users', uid, 'sessions')),
          getDoc(doc(db!, 'users', uid, 'profile', 'current')),
        ]);
        if (disposed) return;

        const pending = pendingState();
        const serverBooks = bookSnapshot.docs
          .map((item) => (item.data() as CloudRecord<UserBookRecord>).data)
          .filter(Boolean);
        const serverSessions = sessionSnapshot.docs
          .map((item) => (item.data() as CloudRecord<ReadingSession>).data)
          .filter(Boolean);

        if (syncState.expected > 0 && serverBooks.length < syncState.expected) {
          publishCloudSyncHealth({
            status: 'error',
            lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
            message: `Inkbound found only ${serverBooks.length.toLocaleString()} of ${syncState.expected.toLocaleString()} expected books online. The library already on this device was kept unchanged.`,
          });
          return;
        }

        const currentBooks = readJson<UserBookRecord[]>(BOOKS_KEY, []);
        const currentSessions = readJson<ReadingSession[]>(SESSIONS_KEY, []);
        const migrationVerified = storage.getItem(accountLibraryMigrationVersionKey(uid))
          === ACCOUNT_LIBRARY_MIGRATION_VERSION;

        // Never describe an empty/partial cloud library as healthy while this
        // device visibly holds an existing pre-account library. This is the
        // exact P0 state where older builds reported "0 books checked" despite
        // hundreds of local books and could later let empty cloud look
        // authoritative.
        if (!canReportCloudLibraryHealthy({
          localBookCount: currentBooks.length,
          cloudBookCount: serverBooks.length,
          migrationVerified,
        })) {
          publishCloudSyncHealth({
            status: 'error',
            lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
            message: `Inkbound found ${currentBooks.length.toLocaleString()} book${currentBooks.length === 1 ? '' : 's'} on this device but only ${serverBooks.length.toLocaleString()} saved to your account. Your local library was kept unchanged while Inkbound finishes attaching it to this account.`,
          });
          return;
        }
        const nextBooks = mergeBooksFromServer(currentBooks, serverBooks, pending.books ?? {});
        const nextSessions = mergeServerCollectionById(currentSessions, serverSessions, pending.sessions ?? {});
        const changedKeys: Array<typeof BOOKS_KEY | typeof SESSIONS_KEY | typeof PROFILE_KEY> = [];

        if (JSON.stringify(currentBooks) !== JSON.stringify(nextBooks)) {
          writeJson(BOOKS_KEY, nextBooks);
          changedKeys.push(BOOKS_KEY);
        }
        if (JSON.stringify(currentSessions) !== JSON.stringify(nextSessions)) {
          writeJson(SESSIONS_KEY, nextSessions);
          changedKeys.push(SESSIONS_KEY);
        }

        if ((!pending.profile || pending.profile.capturedAfterCloudReconcile !== true) && profileSnapshot.exists()) {
          const cloudProfile = (profileSnapshot.data() as CloudRecord<Record<string, unknown>>).data;
          if (cloudProfile) {
            const serialized = JSON.stringify(compactProfileForRuntime(cloudProfile));
            if (storage.getItem(PROFILE_KEY) !== serialized) {
              storage.setItem(PROFILE_KEY, serialized);
              changedKeys.push(PROFILE_KEY);
            }
          }
        }

        if (changedKeys.length) notifyCloudDataUpdated(changedKeys);
        const syncedAt = new Date().toISOString();
        storage.setItem(LAST_SYNC_STORAGE_KEY, syncedAt);
        publishCloudSyncHealth({
          status: 'healthy',
          lastSuccessfulSyncAt: syncedAt,
          message: `Your library is up to date. ${serverBooks.length.toLocaleString()} saved books were checked.`,
        });
      } catch (error) {
        console.error('Inkbound manual cloud refresh failed.', error);
        publishCloudSyncHealth({
          status: 'error',
          lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
          message: 'Inkbound could not check for updates right now. The library already on this device was left unchanged.',
        });
      } finally {
        running.current = false;
      }
    };

    window.addEventListener(INKBOUND_FORCE_CLOUD_REFRESH_EVENT, refreshFromServer);
    return () => {
      disposed = true;
      window.removeEventListener(INKBOUND_FORCE_CLOUD_REFRESH_EVENT, refreshFromServer);
    };
  }, [user?.uid]);

  return null;
};
