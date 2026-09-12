import React, { useEffect, useRef } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import type { ReadingSession, UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import {
  getRuntimeStorage,
  notifyRuntimeStorageChanged,
} from '../../platform/runtimeStorage';
import {
  notifyCloudDataUpdated,
  type CloudSyncedStorageKey,
} from './cloudSyncEvents';
import {
  shouldApplyRemoteTombstone,
  shouldRemoteChangeReplacePending,
} from './syncConflictPolicy';
import {
  crossDeviceCursorKey,
  fullReconciliationVersionKey,
  syncBaselineStateKey,
  syncPendingStateKey,
  SYNC_STORAGE_KEYS,
} from './storageKeys';

const BOOKS_KEY: CloudSyncedStorageKey = SYNC_STORAGE_KEYS.books;
const SESSIONS_KEY: CloudSyncedStorageKey = SYNC_STORAGE_KEYS.sessions;
const PROFILE_KEY: CloudSyncedStorageKey = SYNC_STORAGE_KEYS.profile;
const FULL_RECONCILIATION_VERSION = '1';

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
  profile?: { data: Record<string, unknown>; clientUpdatedAt: string };
}
interface SyncBaseline {
  books: Record<string, string>;
  sessions: Record<string, string>;
  profile?: string;
}

const storage = () => getRuntimeStorage();
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
    const raw = storage().getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  storage().setItem(key, stable(value));
}

function remoteWinsPending<T>(record: CloudRecord<T>, pending?: { clientUpdatedAt: string }): boolean {
  return shouldRemoteChangeReplacePending({
    remoteServerMillis: record.updatedAt?.toMillis() ?? 0,
    remoteClientUpdatedAt: record.clientUpdatedAt,
    pendingClientUpdatedAt: pending?.clientUpdatedAt,
  });
}

function tombstoneWinsPending(record: TombstoneRecord, pending?: RecordMutation<unknown>): boolean {
  return shouldRemoteChangeReplacePending({
    remoteServerMillis: record.deletedAt?.toMillis() ?? 0,
    remoteClientUpdatedAt: record.clientUpdatedAt,
    pendingClientUpdatedAt: pending?.clientUpdatedAt,
  });
}

function reconcileCollection<T extends { id: string }>(
  localItems: T[],
  cloudRecords: Array<CloudRecord<T>>,
  tombstones: TombstoneRecord[],
  pending: Record<string, RecordMutation<T>>,
  baseline: Record<string, string>,
): T[] {
  const next = new Map(localItems.map((item) => [item.id, item]));
  const latestCloudMillis = new Map<string, number>();
  const cloudIds = new Set<string>();

  cloudRecords.forEach((record) => {
    const item = record.data;
    if (!item?.id) return;
    cloudIds.add(item.id);
    const updatedMillis = record.updatedAt?.toMillis() ?? 0;
    latestCloudMillis.set(item.id, updatedMillis);

    const localPending = pending[item.id];
    if (localPending && !remoteWinsPending(record, localPending)) return;

    delete pending[item.id];
    next.set(item.id, item);
    baseline[item.id] = fingerprint(item);
  });

  // DATA_OWNERSHIP rule: if a local record existed in the previous sync baseline
  // but is now absent from Firestore, that absence is a remote deletion unless a
  // durable local mutation says otherwise. This also repairs deletions made by an
  // older build before sync tombstones existed.
  localItems.forEach((item) => {
    if (cloudIds.has(item.id) || pending[item.id] || baseline[item.id] === undefined) return;
    next.delete(item.id);
    delete baseline[item.id];
  });

  tombstones.forEach((record) => {
    const id = record.recordId?.trim();
    if (!id) return;
    const deletedMillis = record.deletedAt?.toMillis() ?? 0;
    if (!shouldApplyRemoteTombstone({
      tombstoneServerMillis: deletedMillis,
      latestRecordServerMillis: latestCloudMillis.get(id) ?? 0,
    })) return;

    const localPending = pending[id];
    if (localPending && !tombstoneWinsPending(record, localPending)) return;

    delete pending[id];
    next.delete(id);
    delete baseline[id];
  });

  return [...next.values()];
}

/**
 * Existing Build 27 devices normally use timestamp deltas. A device whose cursor
 * was seeded while its local cache was already stale can therefore receive every
 * new change while never reconsidering older conflicting records. This bridge
 * performs one bounded full reconciliation per account/device version.
 *
 * Cloud records replace stale local copies unless a durable local mutation is
 * newer. Cloud tombstones and baseline-confirmed remote deletions remove stale
 * cached records under the same conflict rule. Local-only records that never
 * appeared in the baseline are preserved so recovery cannot silently discard an
 * unsynced legacy item.
 */
export const FullCloudReconciliationBridge: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const { user } = useAccountSync();
  const running = useRef(false);

  useEffect(() => {
    if (!user || !db) return undefined;
    const uid = user.uid;
    let disposed = false;

    const finishIfAlreadyComplete = () => {
      if (storage().getItem(fullReconciliationVersionKey(uid)) !== FULL_RECONCILIATION_VERSION) return false;
      onComplete();
      return true;
    };

    const reconcile = async () => {
      if (disposed || running.current || !navigator.onLine || finishIfAlreadyComplete()) return;
      running.current = true;

      try {
        const [bookSnapshot, sessionSnapshot, tombstoneSnapshot, profileSnapshot] = await Promise.all([
          getDocs(collection(db!, 'users', uid, 'books')),
          getDocs(collection(db!, 'users', uid, 'sessions')),
          getDocs(collection(db!, 'users', uid, 'syncTombstones')),
          getDoc(doc(db!, 'users', uid, 'profile', 'current')),
        ]);
        if (disposed) return;

        const pending = readJson<PendingSyncState>(syncPendingStateKey(uid), { books: {}, sessions: {} });
        const baseline = readJson<SyncBaseline>(syncBaselineStateKey(uid), { books: {}, sessions: {} });
        const localBooks = readJson<UserBookRecord[]>(BOOKS_KEY, []);
        const localSessions = readJson<ReadingSession[]>(SESSIONS_KEY, []);

        const cloudBooks = bookSnapshot.docs
          .map((item) => item.data() as CloudRecord<UserBookRecord>)
          .filter((record) => Boolean(record.data?.id));
        const cloudSessions = sessionSnapshot.docs
          .map((item) => item.data() as CloudRecord<ReadingSession>)
          .filter((record) => Boolean(record.data?.id));
        const tombstones = tombstoneSnapshot.docs.map((item) => item.data() as TombstoneRecord);
        const bookTombstones = tombstones.filter((item) => item.kind === 'books');
        const sessionTombstones = tombstones.filter((item) => item.kind === 'sessions');

        const nextBooks = reconcileCollection(localBooks, cloudBooks, bookTombstones, pending.books, baseline.books);
        const nextSessions = reconcileCollection(localSessions, cloudSessions, sessionTombstones, pending.sessions, baseline.sessions);
        const changedKeys: CloudSyncedStorageKey[] = [];

        if (stable(localBooks) !== stable(nextBooks)) {
          writeJson(BOOKS_KEY, nextBooks);
          notifyRuntimeStorageChanged(BOOKS_KEY);
          changedKeys.push(BOOKS_KEY);
        }
        if (stable(localSessions) !== stable(nextSessions)) {
          writeJson(SESSIONS_KEY, nextSessions);
          notifyRuntimeStorageChanged(SESSIONS_KEY);
          changedKeys.push(SESSIONS_KEY);
        }

        let newestMillis = 0;
        cloudBooks.forEach((record) => { newestMillis = Math.max(newestMillis, record.updatedAt?.toMillis() ?? 0); });
        cloudSessions.forEach((record) => { newestMillis = Math.max(newestMillis, record.updatedAt?.toMillis() ?? 0); });
        tombstones.forEach((record) => { newestMillis = Math.max(newestMillis, record.deletedAt?.toMillis() ?? 0); });

        if (profileSnapshot.exists()) {
          const profileRecord = profileSnapshot.data() as CloudRecord<Record<string, unknown>>;
          newestMillis = Math.max(newestMillis, profileRecord.updatedAt?.toMillis() ?? 0);
          if (profileRecord.data && remoteWinsPending(profileRecord, pending.profile)) {
            delete pending.profile;
            const profileValue = stable(profileRecord.data);
            baseline.profile = profileValue;
            if (storage().getItem(PROFILE_KEY) !== profileValue) {
              storage().setItem(PROFILE_KEY, profileValue);
              notifyRuntimeStorageChanged(PROFILE_KEY);
              changedKeys.push(PROFILE_KEY);
            }
          }
        }

        writeJson(syncBaselineStateKey(uid), baseline);
        if (!Object.keys(pending.books).length && !Object.keys(pending.sessions).length && !pending.profile) {
          storage().removeItem(syncPendingStateKey(uid));
        } else {
          writeJson(syncPendingStateKey(uid), pending);
        }
        if (newestMillis > 0) storage().setItem(crossDeviceCursorKey(uid), String(newestMillis));

        storage().setItem(fullReconciliationVersionKey(uid), FULL_RECONCILIATION_VERSION);
        notifyCloudDataUpdated(changedKeys.length ? changedKeys : [BOOKS_KEY, SESSIONS_KEY, PROFILE_KEY]);
        onComplete();
      } catch (error) {
        console.warn('Inkbound full account reconciliation could not complete; it will retry.', error);
      } finally {
        running.current = false;
      }
    };

    if (!finishIfAlreadyComplete()) void reconcile();
    const retry = () => { void reconcile(); };
    window.addEventListener('online', retry);

    return () => {
      disposed = true;
      window.removeEventListener('online', retry);
    };
  }, [user?.uid, onComplete]);

  return null;
};
