import { preserveExistingBookMetadata } from './cloudServerMergePolicy';
import React, { useEffect, useRef } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import type { ReadingSession, UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import { subscribeToRuntimeResume } from '../../platform/runtimeLifecycle';
import { mergeIncomingBookLoanState } from '../ownership/bookOwnership';
import { mergeIncomingBookQuoteState } from '../reading/bookQuotePersistence';
import { mergeIncomingManualCoverState } from './bookUserOwnedPersistence';
import {
  getRuntimeStorage,
  notifyRuntimeStorageChanged,
} from '../../platform/runtimeStorage';
import {
  INKBOUND_CLOUD_DATA_EVENT,
  notifyCloudDataUpdated,
  notifyCoreCloudReconciled,
  type CloudDataUpdatedDetail,
} from './cloudSyncEvents';
import {
  shouldApplyRemoteTombstone,
  shouldRemoteReplacePendingMutation,
} from './syncConflictPolicy';
import {
  crossDeviceCursorKey,
  FULL_RECONCILIATION_VERSION,
  fullReconciliationVersionKey,
  syncBaselineStateKey,
  syncPendingStateKey,
  SYNC_STORAGE_KEYS,
} from './storageKeys';

const BOOKS_KEY = SYNC_STORAGE_KEYS.books;
const SESSIONS_KEY = SYNC_STORAGE_KEYS.sessions;
const PROFILE_KEY = SYNC_STORAGE_KEYS.profile;
const OWNER_UID_KEY = SYNC_STORAGE_KEYS.localOwnerUid;
const HYDRATION_REQUIRED_UID_KEY = SYNC_STORAGE_KEYS.hydrationRequiredOwnerUid;
const FOREGROUND_FALLBACK_MS = 600000;
const QUERY_OVERLAP_MS = 5000;
const LIVE_SIGNAL_DEBOUNCE_MS = 175;

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
  capturedAfterCloudReconcile?: boolean;
}
interface ProfileMutation {
  data: Record<string, unknown>;
  clientUpdatedAt: string;
  capturedAfterCloudReconcile?: boolean;
}
interface PendingSyncState {
  books: Record<string, RecordMutation<UserBookRecord>>;
  sessions: Record<string, RecordMutation<ReadingSession>>;
  profile?: ProfileMutation;
}
interface SyncBaseline {
  books: Record<string, string>;
  sessions: Record<string, string>;
  profile?: string;
}

const runtimeStorage = () => getRuntimeStorage();
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
  // An unreadable canonical value is not evidence of an empty library or
  // queue. Preserve its original bytes and refuse to reconcile over it.
  const raw = runtimeStorage().getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error('[Inkbound persistence] Refusing to replace unreadable stored data.', { key, error });
    throw new Error(`Inkbound cannot safely read ${key}; existing data was preserved.`);
  }
}

function writeJson(key: string, value: unknown) {
  runtimeStorage().setItem(key, stable(value));
}

function readCursor(uid: string): number {
  const saved = Number(runtimeStorage().getItem(crossDeviceCursorKey(uid)) ?? '');
  return Number.isFinite(saved) && saved > 0 ? saved : 0;
}

function readPending(uid: string): PendingSyncState {
  return readJson<PendingSyncState>(syncPendingStateKey(uid), { books: {}, sessions: {} });
}

function writePending(uid: string, pending: PendingSyncState) {
  if (!Object.keys(pending.books).length && !Object.keys(pending.sessions).length && !pending.profile) {
    runtimeStorage().removeItem(syncPendingStateKey(uid));
  } else {
    writeJson(syncPendingStateKey(uid), pending);
  }
}

function readBaseline(uid: string): SyncBaseline {
  return readJson<SyncBaseline>(syncBaselineStateKey(uid), { books: {}, sessions: {} });
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

function upsertBooksById(current: UserBookRecord[], incoming: UserBookRecord[]): UserBookRecord[] {
  if (!incoming.length) return current;
  const next = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => {
    const local = next.get(item.id);
    const withQuotes = mergeIncomingBookQuoteState(local, item);
    const withLoan = mergeIncomingBookLoanState(local, withQuotes);
    const withCover = mergeIncomingManualCoverState(local, withLoan);
    next.set(item.id, preserveExistingBookMetadata(local, withCover));
  });
  return [...next.values()];
}

function removeIds<T extends { id: string }>(current: T[], removed: Set<string>): T[] {
  if (!removed.size) return current;
  return current.filter((item) => !removed.has(item.id));
}

function cloudRecordWinsPending<T>(
  record: CloudRecord<T>,
  pending?: { clientUpdatedAt: string; capturedAfterCloudReconcile?: boolean },
): boolean {
  // Pending mutations from older builds (or created before the reconciliation
  // gate existed) are not proof of fresh reader intent. The saved account copy
  // wins once so a stale device cannot overwrite newer iOS/web data merely by
  // opening the app after being offline.
  return shouldRemoteReplacePendingMutation({
    remoteServerMillis: record.updatedAt?.toMillis() ?? 0,
    remoteClientUpdatedAt: record.clientUpdatedAt,
    pendingClientUpdatedAt: pending?.clientUpdatedAt,
    pendingCapturedAfterCloudReconcile: pending?.capturedAfterCloudReconcile,
  });
}

function tombstoneWinsPending(record: TombstoneRecord, pending?: RecordMutation<unknown>): boolean {
  if (pending && pending.capturedAfterCloudReconcile !== true) return true;

  return shouldRemoteReplacePendingMutation({
    remoteServerMillis: record.deletedAt?.toMillis() ?? 0,
    remoteClientUpdatedAt: record.clientUpdatedAt,
    pendingClientUpdatedAt: pending?.clientUpdatedAt,
    pendingCapturedAfterCloudReconcile: pending?.capturedAfterCloudReconcile,
  });
}

/**
 * Low-cost reconciliation for an already-hydrated device.
 *
 * The working library stays local-first, but four tiny live Firestore signals
 * (latest book, latest session, latest tombstone, and profile) wake this bridge
 * immediately when another device changes cloud state. A ten-minute foreground
 * poll remains only as a safety net if a listener misses a wakeup. The actual
 * reconciliation still uses timestamp-bounded delta queries and the existing
 * pending/conflict rules, so live sync does not reintroduce stale-device overwrites.
 */
export const CrossDeviceDeltaSyncBridge: React.FC = () => {
  const { user } = useAccountSync();
  const pullRunning = useRef(false);
  const knownBookIds = useRef(new Set<string>());

  useEffect(() => {
    if (!user || !db) return undefined;
    const uid = user.uid;
    let disposed = false;
    let initialRetryTimer: number | undefined;
    let liveSignalTimer: number | undefined;

    knownBookIds.current = idsFromStored<UserBookRecord>(BOOKS_KEY);

    const coreHydrationComplete = () => (
      runtimeStorage().getItem(OWNER_UID_KEY) === uid
      && runtimeStorage().getItem(HYDRATION_REQUIRED_UID_KEY) !== uid
      && runtimeStorage().getItem(fullReconciliationVersionKey(uid)) === FULL_RECONCILIATION_VERSION
    );

    const pullDeltas = async () => {
      if (disposed || pullRunning.current || !navigator.onLine || !coreHydrationComplete()) return;

      pullRunning.current = true;
      try {
        const cursor = readCursor(uid);
        const lowerBound = Timestamp.fromMillis(Math.max(0, cursor - QUERY_OVERLAP_MS));
        const [bookSnapshot, sessionSnapshot, tombstoneSnapshot, profileSnapshot] = await Promise.all([
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
          getDoc(doc(db!, 'users', uid, 'profile', 'current')),
        ]);
        if (disposed) return;

        const pending = readPending(uid);
        const baseline = readBaseline(uid);
        const acceptedBooks: UserBookRecord[] = [];
        const acceptedSessions: ReadingSession[] = [];
        const removedBooks = new Set<string>();
        const removedSessions = new Set<string>();
        const bookUpdateMillis = new Map<string, number>();
        const sessionUpdateMillis = new Map<string, number>();
        let newestMillis = cursor;

        bookSnapshot.docs.forEach((item) => {
          const record = item.data() as CloudRecord<UserBookRecord>;
          const updatedMillis = record.updatedAt?.toMillis() ?? 0;
          newestMillis = Math.max(newestMillis, updatedMillis);
          const id = record.data?.id;
          if (!id) return;
          bookUpdateMillis.set(id, updatedMillis);
          if (!cloudRecordWinsPending(record, pending.books[id])) return;
          delete pending.books[id];
          acceptedBooks.push(record.data);
          baseline.books[id] = fingerprint(record.data);
        });

        sessionSnapshot.docs.forEach((item) => {
          const record = item.data() as CloudRecord<ReadingSession>;
          const updatedMillis = record.updatedAt?.toMillis() ?? 0;
          newestMillis = Math.max(newestMillis, updatedMillis);
          const id = record.data?.id;
          if (!id) return;
          sessionUpdateMillis.set(id, updatedMillis);
          if (!cloudRecordWinsPending(record, pending.sessions[id])) return;
          delete pending.sessions[id];
          acceptedSessions.push(record.data);
          baseline.sessions[id] = fingerprint(record.data);
        });

        tombstoneSnapshot.docs.forEach((item) => {
          const record = item.data() as TombstoneRecord;
          const deletedMillis = record.deletedAt?.toMillis() ?? 0;
          newestMillis = Math.max(newestMillis, deletedMillis);
          const recordId = record.recordId?.trim();
          if (!recordId) return;
          if (record.kind === 'books') {
            if (!shouldApplyRemoteTombstone({
              tombstoneServerMillis: deletedMillis,
              latestRecordServerMillis: bookUpdateMillis.get(recordId) ?? 0,
            })) return;
            const pendingMutation = pending.books[recordId];
            // A book explicitly saved on this device but not yet acknowledged
            // by the cloud must not disappear because an older tombstone arrived.
            // Keep the upsert queued until Firestore confirms it.
            if (pendingMutation?.operation === 'upsert' && pendingMutation.capturedAfterCloudReconcile === true) return;
            if (!tombstoneWinsPending(record, pendingMutation)) return;
            delete pending.books[recordId];
            removedBooks.add(recordId);
            delete baseline.books[recordId];
          }
          if (record.kind === 'sessions') {
            if (!shouldApplyRemoteTombstone({
              tombstoneServerMillis: deletedMillis,
              latestRecordServerMillis: sessionUpdateMillis.get(recordId) ?? 0,
            })) return;
            const pendingMutation = pending.sessions[recordId];
            if (!tombstoneWinsPending(record, pendingMutation)) return;
            delete pending.sessions[recordId];
            removedSessions.add(recordId);
            delete baseline.sessions[recordId];
          }
        });

        let acceptedProfile: Record<string, unknown> | undefined;
        if (profileSnapshot.exists()) {
          const profileRecord = profileSnapshot.data() as CloudRecord<Record<string, unknown>>;
          const updatedMillis = profileRecord.updatedAt?.toMillis() ?? 0;
          newestMillis = Math.max(newestMillis, updatedMillis);
          if (updatedMillis > lowerBound.toMillis() && cloudRecordWinsPending(profileRecord, pending.profile)) {
            acceptedProfile = profileRecord.data;
            delete pending.profile;
            baseline.profile = stable(profileRecord.data);
          }
        }

        const books = readJson<UserBookRecord[]>(BOOKS_KEY, []);
        const sessions = readJson<ReadingSession[]>(SESSIONS_KEY, []);
        const nextBooks = removeIds(upsertBooksById(books, acceptedBooks), removedBooks);
        const nextSessions = removeIds(upsertById(sessions, acceptedSessions), removedSessions);
        const changedKeys: Array<typeof BOOKS_KEY | typeof SESSIONS_KEY | typeof PROFILE_KEY> = [];

        if (stable(books) !== stable(nextBooks)) {
          writeJson(BOOKS_KEY, nextBooks);
          knownBookIds.current = new Set(nextBooks.map((book) => book.id));
          notifyRuntimeStorageChanged(BOOKS_KEY);
          changedKeys.push(BOOKS_KEY);
        }

        if (stable(sessions) !== stable(nextSessions)) {
          writeJson(SESSIONS_KEY, nextSessions);
          notifyRuntimeStorageChanged(SESSIONS_KEY);
          changedKeys.push(SESSIONS_KEY);
        }

        if (acceptedProfile && runtimeStorage().getItem(PROFILE_KEY) !== stable(acceptedProfile)) {
          writeJson(PROFILE_KEY, acceptedProfile);
          notifyRuntimeStorageChanged(PROFILE_KEY);
          changedKeys.push(PROFILE_KEY);
        }

        writeJson(syncBaselineStateKey(uid), baseline);
        writePending(uid, pending);
        if (newestMillis > 0) runtimeStorage().setItem(crossDeviceCursorKey(uid), String(newestMillis));
        if (changedKeys.length) notifyCloudDataUpdated(changedKeys);

        // A successful delta pass is the gate that allows queued local writes to
        // resume. This prevents a stale device from publishing old page/session
        // state before it has first seen newer cloud progress from another device.
        notifyCoreCloudReconciled(uid);
      } catch (error) {
        console.warn('Inkbound cross-device delta sync could not complete.', error);
      } finally {
        pullRunning.current = false;
      }
    };

    const scheduleLivePull = () => {
      if (disposed || !coreHydrationComplete()) return;
      if (liveSignalTimer !== undefined) window.clearTimeout(liveSignalTimer);
      liveSignalTimer = window.setTimeout(() => {
        liveSignalTimer = undefined;
        void pullDeltas();
      }, LIVE_SIGNAL_DEBOUNCE_MS);
    };

    const handleCoreCloudUpdate = (event: Event) => {
      const detail = (event as CustomEvent<CloudDataUpdatedDetail>).detail;
      if (!detail?.keys?.some((key) => key === BOOKS_KEY || key === SESSIONS_KEY || key === PROFILE_KEY)) return;
      scheduleLivePull();
    };

    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, handleCoreCloudUpdate);

    // These listeners intentionally watch only the newest record in each growing
    // collection. That restores near-real-time cross-device wakeups without
    // attaching an expensive listener to the reader's entire library.
    const unsubscribeBookSignal = onSnapshot(
      query(collection(db, 'users', uid, 'books'), orderBy('updatedAt', 'desc'), limit(1)),
      scheduleLivePull,
      (error) => console.warn('Inkbound book sync signal listener failed.', error),
    );
    const unsubscribeSessionSignal = onSnapshot(
      query(collection(db, 'users', uid, 'sessions'), orderBy('updatedAt', 'desc'), limit(1)),
      scheduleLivePull,
      (error) => console.warn('Inkbound session sync signal listener failed.', error),
    );
    const unsubscribeTombstoneSignal = onSnapshot(
      query(collection(db, 'users', uid, 'syncTombstones'), orderBy('deletedAt', 'desc'), limit(1)),
      scheduleLivePull,
      (error) => console.warn('Inkbound deletion sync signal listener failed.', error),
    );
    const unsubscribeProfileSignal = onSnapshot(
      doc(db, 'users', uid, 'profile', 'current'),
      scheduleLivePull,
      (error) => console.warn('Inkbound profile sync signal listener failed.', error),
    );

    const unsubscribeRuntimeResume = subscribeToRuntimeResume(() => {
      void pullDeltas();
    });
    const fallback = window.setInterval(() => {
      if (document.visibilityState === 'visible') void pullDeltas();
    }, FOREGROUND_FALLBACK_MS);

    if (coreHydrationComplete()) void pullDeltas();
    else {
      initialRetryTimer = window.setTimeout(() => {
        initialRetryTimer = undefined;
        void pullDeltas();
      }, 2500);
    }

    return () => {
      disposed = true;
      if (initialRetryTimer !== undefined) window.clearTimeout(initialRetryTimer);
      if (liveSignalTimer !== undefined) window.clearTimeout(liveSignalTimer);
      window.clearInterval(fallback);
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, handleCoreCloudUpdate);
      unsubscribeBookSignal();
      unsubscribeSessionSignal();
      unsubscribeTombstoneSignal();
      unsubscribeProfileSignal();
      unsubscribeRuntimeResume();
    };
  }, [user?.uid]);

  return null;
};
