import React, { useEffect, useRef } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import type { ReadingSession, UserBookRecord } from '../../types';
import { mergeIncomingBookLoanState } from '../ownership/bookOwnership';
import { mergeIncomingBookQuoteState } from '../reading/bookQuotePersistence';
import { mergeIncomingManualCoverState } from './bookUserOwnedPersistence';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import { flushLargeBrowserStorage } from '../../platform/largeBrowserStorage';
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
  shouldRemoteReplacePendingMutation,
} from './syncConflictPolicy';
import {
  ACCOUNT_LIBRARY_MIGRATION_VERSION,
  accountLibraryMigrationSnapshotKey,
  accountLibraryMigrationVersionKey,
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
  capturedAfterCloudReconcile?: boolean;
}
interface PendingSyncState {
  books: Record<string, RecordMutation<UserBookRecord>>;
  sessions: Record<string, RecordMutation<ReadingSession>>;
  profile?: {
    data: Record<string, unknown>;
    clientUpdatedAt: string;
    capturedAfterCloudReconcile?: boolean;
  };
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
const MIGRATION_UPLOAD_BATCH_SIZE = 100;

function mergeIncomingUserOwnedBookState(
  current: UserBookRecord | undefined,
  incoming: UserBookRecord,
): UserBookRecord {
  const withQuotes = mergeIncomingBookQuoteState(current, incoming);
  const withLoan = mergeIncomingBookLoanState(current, withQuotes);
  return mergeIncomingManualCoverState(current, withLoan);
}

async function uploadMissingMigrationRecords<T extends { id: string }>(
  uid: string,
  kind: RecordKind,
  items: T[],
  cloudIds: ReadonlySet<string>,
): Promise<number> {
  const missing = items.filter((item) => item?.id && !cloudIds.has(item.id));
  if (missing.length === 0) return 0;

  const clientUpdatedAt = new Date().toISOString();
  for (let index = 0; index < missing.length; index += MIGRATION_UPLOAD_BATCH_SIZE) {
    const batch = missing.slice(index, index + MIGRATION_UPLOAD_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((item) => setDoc(
      doc(db!, 'users', uid, kind, item.id),
      {
        data: item,
        updatedAt: serverTimestamp(),
        clientUpdatedAt,
      },
      { merge: true },
    )));
    const failed = results.filter((result) => result.status === 'rejected');
    if (failed.length > 0) {
      failed.forEach((result) => {
        if (result.status === 'rejected') console.warn(`Inkbound account migration could not upload one ${kind} record yet.`, result.reason);
      });
      throw new Error(`Account migration stopped because ${failed.length} ${kind} record${failed.length === 1 ? '' : 's'} could not be uploaded.`);
    }
  }

  return missing.length;
}

function snapshotIds<T extends { id: string }>(items: T[]): Set<string> {
  return new Set(items.map((item) => item.id).filter(Boolean));
}


function readJson<T>(key: string, fallback: T): T {
  // An unreadable canonical value is not evidence of an empty library or
  // queue. Preserve its original bytes and refuse to reconcile over it.
  const raw = storage().getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error('[Inkbound persistence] Refusing to replace unreadable stored data.', { key, error });
    throw new Error(`Inkbound cannot safely read ${key}; existing data was preserved.`);
  }
}

function writeJson(key: string, value: unknown) {
  storage().setItem(key, stable(value));
}

function remoteWinsPending<T>(
  record: CloudRecord<T>,
  pending?: { clientUpdatedAt: string; capturedAfterCloudReconcile?: boolean },
): boolean {
  if (pending && pending.capturedAfterCloudReconcile !== true) return true;
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

function reconcileCollection<T extends { id: string }>(
  localItems: T[],
  cloudRecords: Array<CloudRecord<T>>,
  tombstones: TombstoneRecord[],
  pending: Record<string, RecordMutation<T>>,
  baseline: Record<string, string>,
  mergeIncoming?: (current: T | undefined, incoming: T) => T,
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
    if (localPending && !remoteWinsPending(record, localPending)) {
      stats.pendingLocalProtected += 1;
      return;
    }

    const previous = next.get(item.id);
    const applied = mergeIncoming ? mergeIncoming(previous, item) : item;
    if (!previous || fingerprint(previous) !== fingerprint(applied)) stats.cloudRecordsApplied += 1;
    delete pending[item.id];
    next.set(item.id, applied);
    baseline[item.id] = fingerprint(item);
  });

  // Absence from a cloud snapshot is not evidence of an authorized deletion.
  // An incomplete cloud upload or transient snapshot must never erase a reader's
  // existing local record. Explicit remote tombstones are handled below.
  localItems.forEach((item) => {
    if (cloudIds.has(item.id)) return;
    if (pending[item.id]) {
      stats.pendingLocalProtected += 1;
      return;
    }
    stats.localOnlyPreserved += 1;
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
 * newer. Only explicit cloud tombstones remove cached records; absence from
 * a snapshot never authorizes deletion. Local-only records remain available
 * for recovery and migration uploads.
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
      const migrationVersion = storage().getItem(accountLibraryMigrationVersionKey(uid));
      if (
        savedVersion !== FULL_RECONCILIATION_VERSION
        || migrationVersion !== ACCOUNT_LIBRARY_MIGRATION_VERSION
      ) return false;
      console.info('[Inkbound sync] Full reconciliation already complete.', {
        version: savedVersion,
        migrationVersion,
      });
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

        // Account attachment is a one-time migration transaction, not ordinary
        // hydration. Preserve the pre-migration local working copy before any
        // cloud reconciliation or upload is allowed to complete.
        const migrationAlreadyVerified = storage().getItem(accountLibraryMigrationVersionKey(uid))
          === ACCOUNT_LIBRARY_MIGRATION_VERSION;
        if (!migrationAlreadyVerified && (localBooks.length > 0 || localSessions.length > 0)) {
          const snapshotKey = accountLibraryMigrationSnapshotKey(uid);
          if (!storage().getItem(snapshotKey)) {
            writeJson(snapshotKey, {
              createdAt: new Date().toISOString(),
              uid,
              books: localBooks,
              sessions: localSessions,
            });
            await flushLargeBrowserStorage();
            if (disposed) return;
            if (!storage().getItem(snapshotKey)) {
              throw new Error('Account migration stopped because Inkbound could not create a durable local recovery snapshot.');
            }
          }
        }

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

        const bookResult = reconcileCollection(
          localBooks,
          cloudBooks,
          bookTombstones,
          pending.books,
          baseline.books,
          mergeIncomingUserOwnedBookState,
        );
        const sessionResult = reconcileCollection(localSessions, cloudSessions, sessionTombstones, pending.sessions, baseline.sessions);
        const nextBooks = bookResult.items;
        const nextSessions = sessionResult.items;

        // Full reconciliation used to preserve local-only records without ever
        // uploading them. That allowed a newly registered reader to keep hundreds
        // of books on the phone while the account cloud library stayed empty.
        // Upload every final local record absent from cloud, then read it back
        // before either migration or reconciliation is marked complete.
        const initialCloudBookIds = snapshotIds(cloudBooks.map((record) => record.data));
        const initialCloudSessionIds = snapshotIds(cloudSessions.map((record) => record.data));
        const missingBookCount = nextBooks.filter((item) => !initialCloudBookIds.has(item.id)).length;
        const missingSessionCount = nextSessions.filter((item) => !initialCloudSessionIds.has(item.id)).length;
        const libraryManifestRef = doc(db!, 'users', uid, 'syncState', 'library');

        if (missingBookCount > 0) {
          await setDoc(libraryManifestRef, {
            status: 'syncing',
            expectedBookCount: nextBooks.length,
            uploadedBookCount: initialCloudBookIds.size,
            syncDirection: 'account-migration',
            updatedAt: serverTimestamp(),
          }, { merge: true });
        }

        const [uploadedBooks, uploadedSessions] = await Promise.all([
          uploadMissingMigrationRecords(uid, 'books', nextBooks, initialCloudBookIds),
          uploadMissingMigrationRecords(uid, 'sessions', nextSessions, initialCloudSessionIds),
        ]);
        if (disposed) return;

        // A delete can leave a stale physical cloud document beside its tombstone.
        // Remove ONLY records with an explicit, newer server-confirmed tombstone;
        // never infer deletion from a missing local ID or a count difference.
        const reconciledBookIds = snapshotIds(nextBooks);
        const reconciledSessionIds = snapshotIds(nextSessions);
        const pruneTombstonedRecords = async <T extends { id: string }>(
          kind: RecordKind,
          records: Array<CloudRecord<T>>,
          deletionRecords: TombstoneRecord[],
          expectedIds: ReadonlySet<string>,
          pendingMutations: Record<string, RecordMutation<T>>,
        ) => {
          const latestTombstone = new Map<string, TombstoneRecord>();
          deletionRecords.forEach((record) => {
            const id = record.recordId?.trim();
            if (!id || !record.deletedAt) return;
            const previous = latestTombstone.get(id);
            if (!previous || (previous.deletedAt?.toMillis() ?? 0) < record.deletedAt.toMillis()) latestTombstone.set(id, record);
          });
          const stale = records.filter((record) => {
            const id = record.data.id;
            const tombstone = latestTombstone.get(id);
            return !expectedIds.has(id) && !pendingMutations[id] && Boolean(tombstone)
              && shouldApplyRemoteTombstone({
                tombstoneServerMillis: tombstone!.deletedAt!.toMillis(),
                latestRecordServerMillis: record.updatedAt?.toMillis() ?? 0,
              });
          });
          await Promise.all(stale.map((record) => deleteDoc(doc(db!, 'users', uid, kind, record.data.id))));
          return stale.length;
        };
        const [prunedBooks, prunedSessions] = await Promise.all([
          pruneTombstonedRecords('books', cloudBooks, bookTombstones, reconciledBookIds, pending.books),
          pruneTombstonedRecords('sessions', cloudSessions, sessionTombstones, reconciledSessionIds, pending.sessions),
        ]);
        if (disposed) return;

        const [verifiedBookSnapshot, verifiedSessionSnapshot] = await Promise.all([
          uploadedBooks > 0 || prunedBooks > 0 ? getDocs(collection(db!, 'users', uid, 'books')) : Promise.resolve(null),
          uploadedSessions > 0 || prunedSessions > 0 ? getDocs(collection(db!, 'users', uid, 'sessions')) : Promise.resolve(null),
        ]);
        if (disposed) return;

        // If reconciliation uploaded nothing, the initial full snapshots are
        // already the verified cloud state. Do not bill a second full-library
        // read just to rediscover the same IDs.
        const verifiedBookIds: Set<string> = verifiedBookSnapshot
          ? new Set<string>(verifiedBookSnapshot.docs.map((item) => item.id))
          : initialCloudBookIds;
        const verifiedSessionIds: Set<string> = verifiedSessionSnapshot
          ? new Set<string>(verifiedSessionSnapshot.docs.map((item) => item.id))
          : initialCloudSessionIds;
        const verifiedBookCount = verifiedBookSnapshot?.size ?? cloudBooks.length;
        const verifiedSessionCount = verifiedSessionSnapshot?.size ?? cloudSessions.length;
        const missingVerifiedBooks = nextBooks.filter((item) => !verifiedBookIds.has(item.id));
        const missingVerifiedSessions = nextSessions.filter((item) => !verifiedSessionIds.has(item.id));
        const expectedBookIds = snapshotIds(nextBooks);
        const expectedSessionIds = snapshotIds(nextSessions);
        const unexpectedVerifiedBooks = [...verifiedBookIds].filter((id) => !expectedBookIds.has(id));
        const unexpectedVerifiedSessions = [...verifiedSessionIds].filter((id) => !expectedSessionIds.has(id));
        if (
          missingVerifiedBooks.length > 0 || missingVerifiedSessions.length > 0
          || unexpectedVerifiedBooks.length > 0 || unexpectedVerifiedSessions.length > 0
        ) {
          // A stale cloud record may be a previously deleted or merged edition.
          // Never delete it automatically, and never certify a mismatched cloud
          // inventory as a completed migration. Preserve the recovery snapshot.
          throw new Error(
            `Account migration inventory mismatch: missing ${missingVerifiedBooks.length} book(s) and ${missingVerifiedSessions.length} session(s); unexpected ${unexpectedVerifiedBooks.length} book(s) and ${unexpectedVerifiedSessions.length} session(s). No cloud records were deleted.`,
          );
        }

        nextBooks.forEach((item) => {
          if (!initialCloudBookIds.has(item.id)) baseline.books[item.id] = fingerprint(item);
        });
        nextSessions.forEach((item) => {
          if (!initialCloudSessionIds.has(item.id)) baseline.sessions[item.id] = fingerprint(item);
        });

        // Never publish an earlier library snapshot over reader edits made
        // while cloud uploads and verification were in flight.
        if (
          stable(readJson<UserBookRecord[]>(BOOKS_KEY, [])) !== stable(localBooks)
          || stable(readJson<ReadingSession[]>(SESSIONS_KEY, [])) !== stable(localSessions)
        ) {
          throw new Error('Local library changed during reconciliation; stale snapshot application blocked.');
        }

        await setDoc(libraryManifestRef, {
          status: 'complete',
          expectedBookCount: nextBooks.length,
          uploadedBookCount: verifiedBookCount,
          syncDirection: 'account-migration',
          completedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });

        // The manifest write itself awaits the network. Recheck immediately
        // before any local overwrite or sync baseline acknowledgement.
        if (
          stable(readJson<UserBookRecord[]>(BOOKS_KEY, [])) !== stable(localBooks)
          || stable(readJson<ReadingSession[]>(SESSIONS_KEY, [])) !== stable(localSessions)
        ) {
          throw new Error('Local library changed while finalizing reconciliation; stale snapshot application blocked.');
        }

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
          if (profileRecord.data && remoteWinsPending(profileRecord, pending.profile)) {
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
          migration: {
            localBooksBefore: localBooks.length,
            localSessionsBefore: localSessions.length,
            cloudBooksBefore: cloudBooks.length,
            cloudSessionsBefore: cloudSessions.length,
            booksUploaded: uploadedBooks,
            sessionsUploaded: uploadedSessions,
            cloudBooksVerified: verifiedBookCount,
            cloudSessionsVerified: verifiedSessionCount,
          },
          profileApplied,
          profilePendingProtected,
          changedKeys,
          newestCloudMillis: newestMillis,
        };

        storage().setItem(diagnosticKey(uid), stable(diagnostic));
        // Ensure reconciled books, sessions, pending mutations, and baselines
        // reach durable storage before acknowledging migration completion.
        await flushLargeBrowserStorage();
        if (disposed) return;
        // These markers are deliberately last. A failed upload/read-back leaves
        // the local working copy and recovery snapshot intact and forces retry.
        storage().setItem(accountLibraryMigrationVersionKey(uid), ACCOUNT_LIBRARY_MIGRATION_VERSION);
        storage().setItem(fullReconciliationVersionKey(uid), FULL_RECONCILIATION_VERSION);
        console.info('[Inkbound sync] Full reconciliation and account-library migration complete.', diagnostic);
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
