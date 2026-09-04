import React, { useEffect, useRef } from 'react';
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
} from 'firebase/firestore';
import type { ReadingSession, UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import {
  INKBOUND_CLOUD_DATA_EVENT,
  notifyCloudDataUpdated,
  type CloudDataUpdatedDetail,
} from './cloudSyncEvents';
import {
  INKBOUND_FORCE_CLOUD_REFRESH_EVENT,
  publishCloudSyncHealth,
} from './cloudSyncHealth';

const BOOKS_KEY = 'inkbound_books';
const SESSIONS_KEY = 'inkbound_sessions';
const PROFILE_KEY = 'inkbound_reader_profile';
const LAST_SYNC_STORAGE_KEY = 'inkbound_last_cloud_sync_at';
const IMPORT_ENRICHMENT_PAUSED_KEY = 'inkbound_import_enrichment_paused_v1';
const IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY = 'inkbound_import_enrichment_retry_progress_v1';
const IMPORT_ENRICHMENT_ACTIVE_RETRY_KEY = 'inkbound_import_enrichment_active_retry_v1';
const CATASTROPHIC_EMPTY_LIBRARY_MIN_BOOKS = 20;

interface CloudRecord<T> {
  data: T;
}

interface PendingMutation<T> {
  operation: 'upsert' | 'delete';
  data?: T;
  clientUpdatedAt: string;
}

interface PendingSyncState {
  books: Record<string, PendingMutation<UserBookRecord>>;
  sessions: Record<string, PendingMutation<ReadingSession>>;
  profile?: { data: Record<string, unknown>; clientUpdatedAt: string };
}

interface RetryProgress {
  status?: string;
  completed?: number;
  total?: number;
  matched?: number;
  covers?: number;
  summaries?: number;
  updatedAt?: string;
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

function mergeMissingById<T extends { id: string }>(current: T[], server: T[], pending: Record<string, PendingMutation<T>>): T[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  server.forEach((item) => {
    if (!pending[item.id] && !merged.has(item.id)) merged.set(item.id, item);
  });
  return [...merged.values()];
}

function compactProfileForRuntime(profile: Record<string, unknown>): Record<string, unknown> {
  const compact = { ...profile };
  delete compact.avatarImageData;
  delete compact.bannerImageData;
  delete compact.avatarMediaKey;
  delete compact.bannerMediaKey;
  return compact;
}

function pauseAutomaticMetadataWork() {
  const storage = getRuntimeStorage();
  storage.setItem(IMPORT_ENRICHMENT_PAUSED_KEY, 'true');
  storage.removeItem(IMPORT_ENRICHMENT_ACTIVE_RETRY_KEY);

  const progress = readJson<RetryProgress | null>(IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY, null);
  if (!progress) return;

  const completed = progress.completed ?? 0;
  const total = progress.total ?? 0;

  // A retry that already checked every requested book is finished, even if an
  // older build left its status as running/error during shutdown. Never relabel
  // a 100% pass as "stopped" just because automatic background work is disabled.
  if (total > 0 && completed >= total) {
    writeJson(IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY, {
      status: 'complete',
      completed: total,
      total,
      matched: progress.matched ?? 0,
      covers: progress.covers ?? 0,
      summaries: progress.summaries ?? 0,
      message: `${total.toLocaleString()} books were checked. Books that still could not be matched remain safely queued for a future manual retry.`,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (progress.status !== 'queued' && progress.status !== 'running') return;

  writeJson(IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY, {
    status: 'error',
    completed,
    total,
    matched: progress.matched ?? 0,
    covers: progress.covers ?? 0,
    summaries: progress.summaries ?? 0,
    message: 'Automatic missing-detail retries were paused to prevent background usage charges. Start a retry manually when you want Inkbound to check those books.',
    updatedAt: new Date().toISOString(),
  });
}

// Run before App renders. Metadata repair may still be started explicitly by the
// user, but it must never silently resume a large retry after a refresh/reopen.
pauseAutomaticMetadataWork();

/**
 * Cost-safe cloud companion.
 *
 * CloudPersistenceBridge remains the normal event-driven sync owner. This bridge
 * intentionally does NOT poll Firestore, refresh on an interval, or refresh on
 * every app resume. It only:
 *   1. protects a known non-empty local library from a catastrophic empty replace,
 *   2. performs a one-time server recovery when the device cache is already empty,
 *   3. performs a full server refresh only after an explicit force-refresh event.
 */
export const CloudServerRefreshBridge: React.FC = () => {
  const { user } = useAccountSync();
  const running = useRef(false);
  const knownBooks = useRef<UserBookRecord[]>(readJson<UserBookRecord[]>(BOOKS_KEY, []));

  useEffect(() => {
    if (!user || !db) {
      publishCloudSyncHealth({
        status: 'idle',
        lastSuccessfulSyncAt: null,
        message: user ? 'Cloud database is unavailable.' : 'Waiting for sign-in.',
      });
      return undefined;
    }

    const uid = user.uid;
    let disposed = false;
    const storage = getRuntimeStorage();

    const pendingState = () => readJson<PendingSyncState>(`inkbound_pending_sync_${uid}_v1`, {
      books: {},
      sessions: {},
    });

    const restoreCatastrophicEmptyLibrary = (event: Event) => {
      const detail = (event as CustomEvent<CloudDataUpdatedDetail>).detail;
      if (!(detail?.keys ?? []).includes(BOOKS_KEY)) return;

      const current = readJson<UserBookRecord[]>(BOOKS_KEY, []);
      if (current.length > 0) {
        knownBooks.current = current;
        return;
      }

      if (knownBooks.current.length < CATASTROPHIC_EMPTY_LIBRARY_MIN_BOOKS) return;
      if (storage.getItem(`inkbound_local_clear_intent_${uid}`) === '1') return;

      writeJson(BOOKS_KEY, knownBooks.current);
      notifyCloudDataUpdated([BOOKS_KEY]);
      publishCloudSyncHealth({
        status: 'error',
        lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
        message: `Inkbound blocked an unexpected empty-library replacement and kept ${knownBooks.current.length.toLocaleString()} locally cached books visible.`,
      });
    };

    const recoverBooksIfLocalCacheIsEmpty = async () => {
      if (running.current || disposed || !navigator.onLine) return;
      const current = readJson<UserBookRecord[]>(BOOKS_KEY, []);
      if (current.length > 0) {
        knownBooks.current = current;
        publishCloudSyncHealth({
          status: 'healthy',
          lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
          message: 'Cost-safe sync is active. Continuous Firebase polling is disabled.',
        });
        return;
      }

      running.current = true;
      publishCloudSyncHealth({
        status: 'checking',
        lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
        message: 'Local library cache is empty. Checking the server once for recovery…',
      });

      try {
        const snapshot = await getDocsFromServer(collection(db, 'users', uid, 'books'));
        if (disposed) return;
        const serverBooks = snapshot.docs
          .map((item) => (item.data() as CloudRecord<UserBookRecord>).data)
          .filter(Boolean);

        if (serverBooks.length > 0) {
          writeJson(BOOKS_KEY, serverBooks);
          knownBooks.current = serverBooks;
          notifyCloudDataUpdated([BOOKS_KEY]);
        }

        const syncedAt = new Date().toISOString();
        storage.setItem(LAST_SYNC_STORAGE_KEY, syncedAt);
        publishCloudSyncHealth({
          status: serverBooks.length > 0 ? 'healthy' : 'error',
          lastSuccessfulSyncAt: syncedAt,
          message: serverBooks.length > 0
            ? `Recovered ${serverBooks.length.toLocaleString()} books from the server without enabling background polling.`
            : 'The server also returned an empty library. Inkbound did not create or delete any records during this recovery check.',
        });
      } catch (error) {
        console.error('Inkbound one-time library recovery failed.', error);
        publishCloudSyncHealth({
          status: 'error',
          lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
          message: 'Inkbound could not complete the one-time cloud recovery check. Your local data was not cleared.',
        });
      } finally {
        running.current = false;
      }
    };

    const refreshFromServer = async () => {
      if (running.current || disposed || !navigator.onLine) return;
      running.current = true;
      publishCloudSyncHealth({
        status: 'checking',
        lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
        message: 'Running the cloud refresh you requested…',
      });

      try {
        const [bookSnapshot, sessionSnapshot, profileSnapshot] = await Promise.all([
          getDocsFromServer(collection(db, 'users', uid, 'books')),
          getDocsFromServer(collection(db, 'users', uid, 'sessions')),
          getDocFromServer(doc(db, 'users', uid, 'profile', 'current')),
        ]);
        if (disposed) return;

        const pending = pendingState();
        const serverBooks = bookSnapshot.docs
          .map((item) => (item.data() as CloudRecord<UserBookRecord>).data)
          .filter(Boolean);
        const serverSessions = sessionSnapshot.docs
          .map((item) => (item.data() as CloudRecord<ReadingSession>).data)
          .filter(Boolean);

        const currentBooks = readJson<UserBookRecord[]>(BOOKS_KEY, []);
        const currentSessions = readJson<ReadingSession[]>(SESSIONS_KEY, []);
        const nextBooks = mergeMissingById(currentBooks, serverBooks, pending.books ?? {});
        const nextSessions = mergeMissingById(currentSessions, serverSessions, pending.sessions ?? {});
        const changedKeys: Array<'inkbound_books' | 'inkbound_sessions' | 'inkbound_reader_profile'> = [];

        if (JSON.stringify(currentBooks) !== JSON.stringify(nextBooks)) {
          writeJson(BOOKS_KEY, nextBooks);
          knownBooks.current = nextBooks;
          changedKeys.push(BOOKS_KEY);
        }
        if (JSON.stringify(currentSessions) !== JSON.stringify(nextSessions)) {
          writeJson(SESSIONS_KEY, nextSessions);
          changedKeys.push(SESSIONS_KEY);
        }

        if (!pending.profile && profileSnapshot.exists()) {
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
          message: `Manual cloud refresh finished. ${serverBooks.length.toLocaleString()} server books were checked without enabling recurring polling.`,
        });
      } catch (error) {
        console.error('Inkbound manual cloud refresh failed.', error);
        publishCloudSyncHealth({
          status: 'error',
          lastSuccessfulSyncAt: storage.getItem(LAST_SYNC_STORAGE_KEY),
          message: 'The requested cloud refresh could not reach Firebase. Existing local data was left intact.',
        });
      } finally {
        running.current = false;
      }
    };

    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, restoreCatastrophicEmptyLibrary);
    window.addEventListener(INKBOUND_FORCE_CLOUD_REFRESH_EVENT, refreshFromServer);
    void recoverBooksIfLocalCacheIsEmpty();

    return () => {
      disposed = true;
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, restoreCatastrophicEmptyLibrary);
      window.removeEventListener(INKBOUND_FORCE_CLOUD_REFRESH_EVENT, refreshFromServer);
    };
  }, [user?.uid]);

  return null;
};
