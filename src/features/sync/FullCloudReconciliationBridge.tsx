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
  FULL_RECONCILIATION_VERSION,
  fullReconciliationVersionKey,
  syncBaselineStateKey,
  syncPendingStateKey,
  SYNC_STORAGE_KEYS,
} from './storageKeys';

const BOOKS_KEY: CloudSyncedStorageKey = SYNC_STORAGE_KEYS.books;
const SESSIONS_KEY: CloudSyncedStorageKey = SYNC_STORAGE_KEYS.sessions;
const PROFILE_KEY: CloudSyncedStorageKey = SYNC_STORAGE_KEYS.profile;

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
interface ReconciliationStats {
  localCount: number;
  cloudCount: number;
  cloudRecordsApplied: number;
  baselineDeletesApplied: number;
  tombstonesApplied: number;
  pendingLocalProtected: number;
  localOnlyPreserved: number;
  finalCount: number;
}
interface ReconciliationResult<T> {
  items: T[];
  stats: ReconciliationStats;
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
const diagnosticKey = (uid: string) => `inkbound_full_reconciliation_diagnostic_${uid}_v2`;

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

function remoteWinsPending<T>(
  record: CloudRecord<T>,
  pending: { clientUpdatedAt: string } | undefined,
  baselineMatchesRemote: boolean,
): boolean {
  if (!pending) return true;
  if (baselineMatchesRemote) return false;

  return shouldRemoteChangeReplacePending({
    remoteServerMillis: record.updatedAt?.toMillis() ?? 0,
    remoteClientUpdatedAt: record.clientUpdatedAt,
    pendingClientUpdatedAt: pending.clientUpdatedAt,
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
): ReconciliationResult<T> {
  const next = new Map(localItems.map((item) => [item.id, item]));
  const latestCloudMillis = new Map<string, number>();
  const cloudIds = new Set<string>();
  const stats: ReconciliationStats = {
    localCount: localItems.length,
    cloudCount: cloudRecords.length,
    cloudRecordsApplied: 0,
    baselineDeletesApplied: 0,
    tombstonesApplied: 0,
    pendingLocalProtected: 0,
    localOnlyPreserved: 0,
    finalCount: localItems.length,
  };

  cloudRecords.forEach((record) => {
    const item = record.data;
    if (!item?.id) return;
    cloudIds.add(item.id);
    const updatedMillis = record.updatedAt?.toMillis() ?? 0;
    latestCloudMillis.set(item.id, updatedMillis);

    const localPending = pending[item.id];
    if (localPending && !remoteWinsPending(record, localPending, baseline[item.id] === fingerprint(record.data))) {
      stats.pendingLocalProtected += 1;
      return;
    }

    const previous = next.get(item.id);
    if (!previous || fingerprint(previous) !== fingerprint(item)) stats.cloudRecordsApplied += 1;
    delete pending[item.id];
    next.set(item.id, item);
    baseline[item.id] = fingerprint(item);
  });

  // DATA_OWNERSHIP rule: if a local record existed in the previous sync baseline
  // but is now absent from Firestore, that absence is a remote deletion unless a
  // durable local mutation says otherwise. This also repairs deletions made by an
  // older build before sync tombstones existed.
  localItems.forEach((item) => {
    if (cloudIds.has(item.id)) return;
    if (pending[item.id]) {
      stats.pendingLocalProtected += 1;
      return;
    }
    if (baseline[item.id] === undefined) {
      stats.localOnlyPreserved += 1;
      return;
    }
    if (next.delete(item.id)) stats.baselineDeletesApplied += 1;
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
    if (localPending && !tombstoneWinsPending(record, localPending)) {
      stats.pendingLocalProtected += 1;
      return;
    }

    delete pending[id];
    if (next.delete(id)) stats.tombstonesApplied += 1;
    delete baseline[id];
  });

  const items = [...next.values()];
  stats.finalCount = items.length;
  return { items, stats };
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
      const savedVersion = storage().getItem(fullReconciliationVersionKey(uid));
      if (savedVersion !== FULL_RECONCILIATION_VERSION) return false;
      console.info('[Inkbound sync] Full reconciliation already complete.', { version: savedVersion });
      onComplete();
      return true;
    };

    const reconcile = async () => {
      if (disposed || running.current || !navigator.onLine || finishIfAlreadyComplete()) return;
      running.current = true;
      const startedAt = new Date().toISOString();
      console.info('[Inkbound sync] Full reconciliation started.', {
        version: FULL_RECONCILIATION_VERSION,
        startedAt,
      });

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
        const pendingBooksBefore = Object.keys(pending.books).length;
        const pendingSessionsBefore = Object.keys(pending.sessions).length;

        const cloudBooks = bookSnapshot.docs
          .map((item) => item.data() as CloudRecord<UserBookRecord>)
          .filter((record) => Boolean(record.data?.id));
        const cloudSessions = sessionSnapshot.docs
          .map((item) => item.data() as CloudRecord<ReadingSession>)
          .filter((record) => Boolean(record.data?.id));
        const tombstones = tombstoneSnapshot.docs.map((item) => item.data() as TombstoneRecord);
        const bookTombstones = tombstones.filter((item) => item.kind === 'books');
        const sessionTombstones = tombstones.filter((item) => item.kind === 'sessions');

        const bookResult = reconcileCollection(localBooks, cloudBooks, bookTombstones, pending.books, baseline.books);
        const sessionResult = reconcileCollection(localSessions, cloudSessions, sessionTombstones, pending.sessions, baseline.sessions);
        const nextBooks = bookResult.items;
        const nextSessions = sessionResult.items;
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

        let profileApplied = false;
        let profilePendingProtected = false;
        if (profileSnapshot.exists()) {
          const profileRecord = profileSnapshot.data() as CloudRecord<Record<string, unknown>>;
          newestMillis = Math.max(newestMillis, profileRecord.updatedAt?.toMillis() ?? 0);
          if (profileRecord.data && remoteWinsPending(profileRecord, pending.profile, baseline.profile === stable(profileRecord.data))) {
            delete pending.profile;
            const profileValue = stable(profileRecord.data);
            baseline.profile = profileValue;
            if (storage().getItem(PROFILE_KEY) !== profileValue) {
              storage().setItem(PROFILE_KEY, profileValue);
              notifyRuntimeStorageChanged(PROFILE_KEY);
              changedKeys.push(PROFILE_KEY);
              profileApplied = true;
            }
          } else if (pending.profile) {
            profilePendingProtected = true;
          }
        }

        writeJson(syncBaselineStateKey(uid), baseline);
        if (!Object.keys(pending.books).length && !Object.keys(pending.sessions).length && !pending.profile) {
          storage().removeItem(syncPendingStateKey(uid));
        } else {
          writeJson(syncPendingStateKey(uid), pending);
        }
        if (newestMillis > 0) storage().setItem(crossDeviceCursorKey(uid), String(newestMillis));

        const completedAt = new Date().toISOString();
        const diagnostic = {
          version: FULL_RECONCILIATION_VERSION,
          startedAt,
          completedAt,
          books: bookResult.stats,
          sessions: sessionResult.stats,
          tombstonesRead: tombstones.length,
          bookTombstonesRead: bookTombstones.length,
          sessionTombstonesRead: sessionTombstones.length,
          pendingBefore: {
            books: pendingBooksBefore,
            sessions: pendingSessionsBefore,
            profile: Boolean(readJson<PendingSyncState>(syncPendingStateKey(uid), { books: {}, sessions: {} }).profile),
          },
          pendingAfter: {
            books: Object.keys(pending.books).length,
            sessions: Object.keys(pending.sessions).length,
            profile: Boolean(pending.profile),
          },
          profileApplied,
          profilePendingProtected,
          changedKeys,
          newestCloudMillis: newestMillis,
        };

        storage().setItem(diagnosticKey(uid), stable(diagnostic));
        storage().setItem(fullReconciliationVersionKey(uid), FULL_RECONCILIATION_VERSION);
        console.info('[Inkbound sync] Full reconciliation complete.', diagnostic);
        notifyCloudDataUpdated(changedKeys.length ? changedKeys : [BOOKS_KEY, SESSIONS_KEY, PROFILE_KEY]);
        onComplete();
      } catch (error) {
        const failedAt = new Date().toISOString();
        const diagnostic = {
          version: FULL_RECONCILIATION_VERSION,
          startedAt,
          failedAt,
          error: error instanceof Error ? error.message : String(error),
        };
        storage().setItem(diagnosticKey(uid), stable(diagnostic));
        console.warn('[Inkbound sync] Full account reconciliation could not complete; it will retry.', diagnostic, error);
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
