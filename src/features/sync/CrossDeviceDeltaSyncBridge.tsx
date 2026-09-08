import React, { useEffect, useRef } from 'react';
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import type { ReadingSession, UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import {
  getRuntimeStorage,
  notifyRuntimeStorageChanged,
} from '../../platform/runtimeStorage';
import {
  INKBOUND_LOCAL_DATA_CHANGED_EVENT,
  notifyCloudDataUpdated,
  type LocalDataChangedDetail,
} from './cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from './storageKeys';

const BOOKS_KEY = SYNC_STORAGE_KEYS.books;
const SESSIONS_KEY = SYNC_STORAGE_KEYS.sessions;
const LAST_FULL_SYNC_KEY = 'inkbound_last_cloud_sync_at';
const FOREGROUND_FALLBACK_MS = 120000;
const QUERY_OVERLAP_MS = 5000;

type RecordKind = 'books' | 'sessions';
interface CloudRecord<T> {
  data: T;
  updatedAt?: Timestamp;
  clientUpdatedAt?: string;
}
interface TombstoneRecord {
  kind?: RecordKind;
  recordId?: string;
  deletedAt?: Timestamp;
  clientUpdatedAt?: string;
}
interface RecordMutation<T> {
  operation: 'upsert' | 'delete';
  data?: T;
  clientUpdatedAt: string;
}
interface PendingSyncState {
  books: Record<string, RecordMutation<UserBookRecord>>;
  sessions: Record<string, RecordMutation<ReadingSession>>;
}
interface SyncBaseline {
  books: Record<string, string>;
  sessions: Record<string, string>;
  profile?: string;
}

const runtimeStorage = () => getRuntimeStorage();
const cursorKey = (uid: string) => `inkbound_cross_device_cursor_${uid}_v1`;
const pendingKey = (uid: string) => `inkbound_pending_sync_${uid}_v1`;
const baselineKey = (uid: string) => `inkbound_sync_baseline_${uid}_v2`;
const stable = (value: unknown) => JSON.stringify(value);
const hashText = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};
const fingerprint = (value: unknown) => hashText(stable(value));

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = runtimeStorage().getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  runtimeStorage().setItem(key, stable(value));
}

function readCursor(uid: string): number {
  const saved = Number(runtimeStorage().getItem(cursorKey(uid)) ?? '');
  if (Number.isFinite(saved) && saved > 0) return saved;
  const lastFullSync = Date.parse(runtimeStorage().getItem(LAST_FULL_SYNC_KEY) ?? '');
  return Number.isFinite(lastFullSync) && lastFullSync > 0 ? lastFullSync : 0;
}

function readPending(uid: string): PendingSyncState {
  return readJson<PendingSyncState>(pendingKey(uid), { books: {}, sessions: {} });
}

function readBaseline(uid: string): SyncBaseline {
  return readJson<SyncBaseline>(baselineKey(uid), { books: {}, sessions: {} });
}

function idsFromStored<T extends { id: string }>(key: string): Set<string> {
  return new Set(readJson<T[]>(key, []).map((item) => item.id));
}

function upsertById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  if (!incoming.length) return current;
  const next = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => next.set(item.id, item));
  return [...next.values()];
}

function removeIds<T extends { id: string }>(current: T[], removed: Set<string>): T[] {
  if (!removed.size) return current;
  return current.filter((item) => !removed.has(item.id));
}

/**
 * Low-cost reconciliation for devices that already have a local library.
 *
 * Ordinary local work remains local-first and upload-only. This bridge pulls only
 * records whose Firestore updatedAt is newer than the device cursor when the app
 * opens/resumes/focuses and on a slow foreground fallback. It never installs a
 * listener on the full books or sessions collections, so a 1,800-book library
 * does not incur 1,800 reads just for opening Inkbound after the initial cursor is
 * established.
 *
 * Deletions use tiny tombstone documents because deleted Firestore documents can
 * no longer be discovered by an updatedAt query on another device.
 */
export const CrossDeviceDeltaSyncBridge: React.FC = () => {
  const { user } = useAccountSync();
  const pullRunning = useRef(false);
  const knownBookIds = useRef(new Set<string>());
  const knownSessionIds = useRef(new Set<string>());

  useEffect(() => {
    if (!user || !db) return undefined;
    const uid = user.uid;
    let disposed = false;

    knownBookIds.current = idsFromStored<UserBookRecord>(BOOKS_KEY);
    knownSessionIds.current = idsFromStored<ReadingSession>(SESSIONS_KEY);

    const writeTombstones = async (kind: RecordKind, ids: string[]) => {
      if (!ids.length || disposed || !navigator.onLine) return;
      const now = new Date().toISOString();
      await Promise.all(ids.map((recordId) => setDoc(
        doc(db!, 'users', uid, 'syncTombstones', `${kind}_${recordId}`),
        {
          kind,
          recordId,
          clientUpdatedAt: now,
          deletedAt: serverTimestamp(),
        },
        { merge: true },
      )));
    };

    const captureLocalDeletes = (event: Event) => {
      const detail = (event as CustomEvent<LocalDataChangedDetail>).detail;
      const changed = new Set<string>(detail?.keys ?? []);

      if (changed.has(BOOKS_KEY)) {
        const next = idsFromStored<UserBookRecord>(BOOKS_KEY);
        const removed = [...knownBookIds.current].filter((id) => !next.has(id));
        knownBookIds.current = next;
        void writeTombstones('books', removed).catch(() => undefined);
      }

      if (changed.has(SESSIONS_KEY)) {
        const next = idsFromStored<ReadingSession>(SESSIONS_KEY);
        const removed = [...knownSessionIds.current].filter((id) => !next.has(id));
        knownSessionIds.current = next;
        void writeTombstones('sessions', removed).catch(() => undefined);
      }
    };

    const pullDeltas = async () => {
      if (disposed || pullRunning.current || !navigator.onLine) return;
      // A new/empty device is already handled by OneShotCloudHydrationBridge.
      // Waiting here prevents a second full collection read during first restore.
      if (knownBookIds.current.size === 0 && !runtimeStorage().getItem(cursorKey(uid))) return;

      pullRunning.current = true;
      try {
        const cursor = readCursor(uid);
        const lowerBound = Timestamp.fromMillis(Math.max(0, cursor - QUERY_OVERLAP_MS));
        const [bookSnapshot, sessionSnapshot, tombstoneSnapshot] = await Promise.all([
          getDocs(query(
            collection(db!, 'users', uid, 'books'),
            where('updatedAt', '>', lowerBound),
            orderBy('updatedAt', 'asc'),
          )),
          getDocs(query(
            collection(db!, 'users', uid, 'sessions'),
            where('updatedAt', '>', lowerBound),
            orderBy('updatedAt', 'asc'),
          )),
          getDocs(query(
            collection(db!, 'users', uid, 'syncTombstones'),
            where('deletedAt', '>', lowerBound),
            orderBy('deletedAt', 'asc'),
          )),
        ]);
        if (disposed) return;

        const pending = readPending(uid);
        const baseline = readBaseline(uid);
        const acceptedBooks: UserBookRecord[] = [];
        const acceptedSessions: ReadingSession[] = [];
        const removedBooks = new Set<string>();
        const removedSessions = new Set<string>();
        let newestMillis = cursor;

        bookSnapshot.docs.forEach((item) => {
          const record = item.data() as CloudRecord<UserBookRecord>;
          const updatedMillis = record.updatedAt?.toMillis() ?? 0;
          newestMillis = Math.max(newestMillis, updatedMillis);
          if (!record.data?.id || pending.books[record.data.id]) return;
          acceptedBooks.push(record.data);
          baseline.books[record.data.id] = fingerprint(record.data);
        });

        sessionSnapshot.docs.forEach((item) => {
          const record = item.data() as CloudRecord<ReadingSession>;
          const updatedMillis = record.updatedAt?.toMillis() ?? 0;
          newestMillis = Math.max(newestMillis, updatedMillis);
          if (!record.data?.id || pending.sessions[record.data.id]) return;
          acceptedSessions.push(record.data);
          baseline.sessions[record.data.id] = fingerprint(record.data);
        });

        tombstoneSnapshot.docs.forEach((item) => {
          const record = item.data() as TombstoneRecord;
          const deletedMillis = record.deletedAt?.toMillis() ?? 0;
          newestMillis = Math.max(newestMillis, deletedMillis);
          const recordId = record.recordId?.trim();
          if (!recordId) return;
          if (record.kind === 'books' && !pending.books[recordId]) {
            removedBooks.add(recordId);
            delete baseline.books[recordId];
          }
          if (record.kind === 'sessions' && !pending.sessions[recordId]) {
            removedSessions.add(recordId);
            delete baseline.sessions[recordId];
          }
        });

        let books = readJson<UserBookRecord[]>(BOOKS_KEY, []);
        let sessions = readJson<ReadingSession[]>(SESSIONS_KEY, []);
        const nextBooks = removeIds(upsertById(books, acceptedBooks), removedBooks);
        const nextSessions = removeIds(upsertById(sessions, acceptedSessions), removedSessions);
        const changedKeys: Array<typeof BOOKS_KEY | typeof SESSIONS_KEY> = [];

        if (stable(books) !== stable(nextBooks)) {
          books = nextBooks;
          writeJson(BOOKS_KEY, books);
          knownBookIds.current = new Set(books.map((book) => book.id));
          notifyRuntimeStorageChanged(BOOKS_KEY);
          changedKeys.push(BOOKS_KEY);
        }

        if (stable(sessions) !== stable(nextSessions)) {
          sessions = nextSessions;
          writeJson(SESSIONS_KEY, sessions);
          knownSessionIds.current = new Set(sessions.map((session) => session.id));
          notifyRuntimeStorageChanged(SESSIONS_KEY);
          changedKeys.push(SESSIONS_KEY);
        }

        writeJson(baselineKey(uid), baseline);
        if (newestMillis > 0) runtimeStorage().setItem(cursorKey(uid), String(newestMillis));
        if (changedKeys.length) notifyCloudDataUpdated(changedKeys);
      } catch (error) {
        console.warn('Inkbound cross-device delta sync could not complete.', error);
      } finally {
        pullRunning.current = false;
      }
    };

    const establishCursorAfterFirstHydration = () => {
      const books = idsFromStored<UserBookRecord>(BOOKS_KEY);
      if (!books.size) return;
      knownBookIds.current = books;
      knownSessionIds.current = idsFromStored<ReadingSession>(SESSIONS_KEY);
      // If this device was empty, OneShotCloudHydration already fetched the full
      // current account copy. Start future delta checks from now instead of paying
      // for a second full read immediately afterward.
      if (!runtimeStorage().getItem(cursorKey(uid))) {
        runtimeStorage().setItem(cursorKey(uid), String(Date.now()));
      }
    };

    window.addEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, captureLocalDeletes);
    window.addEventListener('online', pullDeltas);
    window.addEventListener('focus', pullDeltas);
    const visibilityHandler = () => {
      if (document.visibilityState === 'visible') void pullDeltas();
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    const fallback = window.setInterval(() => {
      if (document.visibilityState === 'visible') void pullDeltas();
    }, FOREGROUND_FALLBACK_MS);

    // Existing devices reconcile immediately. Empty/new devices let the one-shot
    // hydrator finish first, then establish their delta cursor from that copy.
    if (knownBookIds.current.size > 0) {
      void pullDeltas();
    } else {
      window.setTimeout(establishCursorAfterFirstHydration, 2500);
    }

    return () => {
      disposed = true;
      window.clearInterval(fallback);
      window.removeEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, captureLocalDeletes);
      window.removeEventListener('online', pullDeltas);
      window.removeEventListener('focus', pullDeltas);
      document.removeEventListener('visibilitychange', visibilityHandler);
    };
  }, [user?.uid]);

  return null;
};
