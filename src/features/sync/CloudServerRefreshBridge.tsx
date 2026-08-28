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
import { subscribeToRuntimeResume } from '../../platform/runtimeLifecycle';
import { notifyCloudDataUpdated } from './cloudSyncEvents';
import {
  INKBOUND_FORCE_CLOUD_REFRESH_EVENT,
  publishCloudSyncHealth,
} from './cloudSyncHealth';

const BOOKS_KEY = 'inkbound_books';
const SESSIONS_KEY = 'inkbound_sessions';
const PROFILE_KEY = 'inkbound_reader_profile';
const LAST_SYNC_STORAGE_KEY = 'inkbound_last_cloud_sync_at';
const REFRESH_INTERVAL_MS = 30_000;

interface CloudRecord<T> {
  data: T;
  clientUpdatedAt?: string;
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

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = getRuntimeStorage().getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function mergeServerRecords<T extends { id: string }>(
  current: T[],
  server: T[],
  pending: Record<string, PendingMutation<T>>,
): T[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  server.forEach((item) => {
    if (!pending[item.id]) merged.set(item.id, item);
  });
  return [...merged.values()];
}

function errorMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown cloud error');
  return [code, message].filter(Boolean).join(': ');
}

/**
 * A server-authoritative fallback for browsers whose long-lived Firestore
 * listener becomes unreliable. It performs explicit server reads on sign-in,
 * foreground/resume, manual retry, and a modest interval. Existing local
 * pending mutations always win until CloudPersistenceBridge flushes them, so
 * this repair path cannot overwrite offline edits that have not synced yet.
 */
export const CloudServerRefreshBridge: React.FC = () => {
  const { user } = useAccountSync();
  const running = useRef(false);

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

    const refreshFromServer = async () => {
      if (running.current || disposed || !navigator.onLine) return;
      running.current = true;
      publishCloudSyncHealth({
        status: 'checking',
        lastSuccessfulSyncAt: getRuntimeStorage().getItem(LAST_SYNC_STORAGE_KEY),
        message: 'Checking the Inkbound cloud for newer account data…',
      });

      try {
        const [bookSnapshot, sessionSnapshot, profileSnapshot] = await Promise.all([
          getDocsFromServer(collection(db, 'users', uid, 'books')),
          getDocsFromServer(collection(db, 'users', uid, 'sessions')),
          getDocFromServer(doc(db, 'users', uid, 'profile', 'current')),
        ]);
        if (disposed) return;

        const pending = readJson<PendingSyncState>(`inkbound_pending_sync_${uid}_v1`, {
          books: {},
          sessions: {},
        });

        const serverBooks = bookSnapshot.docs
          .map((item) => (item.data() as CloudRecord<UserBookRecord>).data)
          .filter(Boolean);
        const serverSessions = sessionSnapshot.docs
          .map((item) => (item.data() as CloudRecord<ReadingSession>).data)
          .filter(Boolean);

        const currentBooks = readJson<UserBookRecord[]>(BOOKS_KEY, []);
        const currentSessions = readJson<ReadingSession[]>(SESSIONS_KEY, []);
        const nextBooks = mergeServerRecords(currentBooks, serverBooks, pending.books ?? {});
        const nextSessions = mergeServerRecords(currentSessions, serverSessions, pending.sessions ?? {});

        const changedKeys: Array<'inkbound_books' | 'inkbound_sessions' | 'inkbound_reader_profile'> = [];
        const storage = getRuntimeStorage();
        const nextBooksJson = JSON.stringify(nextBooks);
        const nextSessionsJson = JSON.stringify(nextSessions);
        if (storage.getItem(BOOKS_KEY) !== nextBooksJson) {
          storage.setItem(BOOKS_KEY, nextBooksJson);
          changedKeys.push(BOOKS_KEY);
        }
        if (storage.getItem(SESSIONS_KEY) !== nextSessionsJson) {
          storage.setItem(SESSIONS_KEY, nextSessionsJson);
          changedKeys.push(SESSIONS_KEY);
        }

        if (!pending.profile && profileSnapshot.exists()) {
          const cloudProfile = (profileSnapshot.data() as CloudRecord<Record<string, unknown>>).data;
          if (cloudProfile) {
            const serialized = JSON.stringify(cloudProfile);
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
          message: `Cloud sync is healthy. Verified ${serverBooks.length.toLocaleString()} books from the server.`,
        });
      } catch (error) {
        console.error('Inkbound authoritative cloud refresh failed.', error);
        publishCloudSyncHealth({
          status: 'error',
          lastSuccessfulSyncAt: getRuntimeStorage().getItem(LAST_SYNC_STORAGE_KEY),
          message: `Cloud sync could not reach Firebase: ${errorMessage(error)}`,
        });
      } finally {
        running.current = false;
      }
    };

    void refreshFromServer();
    const interval = window.setInterval(() => void refreshFromServer(), REFRESH_INTERVAL_MS);
    const unsubscribeResume = subscribeToRuntimeResume(() => void refreshFromServer());
    const forceRefresh = () => void refreshFromServer();
    window.addEventListener(INKBOUND_FORCE_CLOUD_REFRESH_EVENT, forceRefresh);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      unsubscribeResume();
      window.removeEventListener(INKBOUND_FORCE_CLOUD_REFRESH_EVENT, forceRefresh);
    };
  }, [user?.uid]);

  return null;
};
