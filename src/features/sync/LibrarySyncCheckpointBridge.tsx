import React, { useEffect, useRef } from 'react';
import {
  collection,
  doc,
  getDocs,
  deleteDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import { subscribeToRuntimeResume } from '../../platform/runtimeLifecycle';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import {
  INKBOUND_LOCAL_DATA_CHANGED_EVENT,
  type LocalDataChangedDetail,
} from './cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from './storageKeys';

const BOOKS_KEY = SYNC_STORAGE_KEYS.books;
const CHECKPOINT_KEY_PREFIX = 'inkbound_library_sync_checkpoint_v1_';
const VERIFY_DELAY_MS = 15000;
const REPAIR_BATCH_SIZE = 100;

type LibraryCountDirection = 'grow' | 'shrink';

interface LocalCheckpoint {
  expectedBookCount: number;
  previousBookCount?: number;
  direction?: LibraryCountDirection;
  createdAt: string;
}

function readBooks(): UserBookRecord[] {
  try {
    const raw = getRuntimeStorage().getItem(BOOKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as UserBookRecord[] : [];
  } catch {
    return [];
  }
}

function readBookCount(): number {
  return readBooks().length;
}

function readCheckpoint(uid: string): LocalCheckpoint | null {
  try {
    const raw = getRuntimeStorage().getItem(`${CHECKPOINT_KEY_PREFIX}${uid}`);
    return raw ? JSON.parse(raw) as LocalCheckpoint : null;
  } catch {
    return null;
  }
}

function writeCheckpoint(uid: string, checkpoint: LocalCheckpoint) {
  getRuntimeStorage().setItem(`${CHECKPOINT_KEY_PREFIX}${uid}`, JSON.stringify(checkpoint));
}

function clearCheckpoint(uid: string) {
  getRuntimeStorage().removeItem(`${CHECKPOINT_KEY_PREFIX}${uid}`);
}

/**
 * A shrink checkpoint must be verified by record identity, not only count.
 * Only remove stale cloud documents when a newer, server-confirmed deletion
 * tombstone exists. Never infer deletion from a missing local record.
 */
async function reconcileShrinkCheckpoint(uid: string): Promise<{ cloudCount: number; matches: boolean; extraIds: string[]; missingIds: string[] }> {
  if (!db) throw new Error('Cloud unavailable');
  const localIds = new Set(readBooks().map((book) => book.id));
  const cloud = await getDocs(collection(db, 'users', uid, 'books'));
  const tombstones = await getDocs(collection(db, 'users', uid, 'syncTombstones'));
  const deletedAt = new Map<string, number>();
  tombstones.docs.forEach((entry) => {
    const value = entry.data() as { kind?: string; recordId?: string; deletedAt?: { toMillis(): number } };
    if (value.kind !== 'books' || !value.recordId || !value.deletedAt) return;
    deletedAt.set(value.recordId, Math.max(deletedAt.get(value.recordId) ?? 0, value.deletedAt.toMillis()));
  });
  const stale = cloud.docs.filter((entry) => {
    if (localIds.has(entry.id)) return false;
    const deletedMillis = deletedAt.get(entry.id);
    const updatedMillis = (entry.data() as { updatedAt?: { toMillis(): number } }).updatedAt?.toMillis() ?? 0;
    return deletedMillis !== undefined && deletedMillis > updatedMillis;
  });
  // The tombstone is durable evidence of an explicit deletion. An unrecognized
  // extra document is never removed here, even when counts differ.
  await Promise.all(stale.map((entry) => deleteDoc(entry.ref)));
  const remainingIds = new Set(cloud.docs.filter((entry) => !stale.includes(entry)).map((entry) => entry.id));
  const extraIds = [...remainingIds].filter((id) => !localIds.has(id));
  const missingIds = [...localIds].filter((id) => !remainingIds.has(id));
  return { cloudCount: remainingIds.size, matches: extraIds.length === 0 && missingIds.length === 0, extraIds, missingIds };
}

/**
 * Repairs a legacy/partial growth upload without overwriting any cloud record
 * that already exists. This is deliberately limited to an existing growth
 * checkpoint whose full expected library is still present locally.
 *
 * Older beta builds could leave a checkpoint saying e.g. 228 expected while only
 * 179 documents reached Firestore. The normal delta bridge cannot discover those
 * missing records after restart because they are no longer in its pending queue.
 * This pass compares IDs once, uploads only the missing local records, then lets
 * normal checkpoint verification mark the backup complete.
 */
async function repairMissingGrowthRecords(uid: string, checkpoint: LocalCheckpoint): Promise<number> {
  if (!db || checkpoint.direction !== 'grow') return 0;

  const localBooks = readBooks();
  if (localBooks.length < checkpoint.expectedBookCount) return 0;

  const booksRef = collection(db, 'users', uid, 'books');
  const cloudSnapshot = await getDocs(booksRef);
  const cloudIds = new Set(cloudSnapshot.docs.map((item) => item.id));
  // Legacy growth repair must not resurrect an explicitly deleted book.
  // Compare server timestamps so a genuinely newer re-add can still survive.
  const tombstones = await getDocs(collection(db, 'users', uid, 'syncTombstones'));
  const deletedBookMillis = new Map(tombstones.docs
    .map((item) => item.data() as { kind?: string; recordId?: string; deletedAt?: { toMillis(): number } })
    .filter((item) => item.kind === 'books' && item.recordId && item.deletedAt)
    .map((item) => [item.recordId!, item.deletedAt!.toMillis()] as const));
  const missingBooks = localBooks.filter((book) => book?.id && !cloudIds.has(book.id) && !deletedBookMillis.has(book.id));
  if (missingBooks.length === 0) return 0;

  const clientUpdatedAt = new Date().toISOString();
  let uploaded = 0;
  for (let index = 0; index < missingBooks.length; index += REPAIR_BATCH_SIZE) {
    const batch = missingBooks.slice(index, index + REPAIR_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((book) => setDoc(
      doc(db!, 'users', uid, 'books', book.id),
      {
        data: book,
        updatedAt: serverTimestamp(),
        clientUpdatedAt,
      },
      { merge: true },
    )));
    uploaded += results.filter((result) => result.status === 'fulfilled').length;
    results.forEach((result) => {
      if (result.status === 'rejected') {
        console.warn('Inkbound checkpoint repair will retry a missing book upload later.', result.reason);
      }
    });
  }

  return uploaded;
}

/**
 * Records the expected size of a reader's library before a large local change
 * begins syncing to Firestore. Recovery code can then distinguish a complete
 * cloud library from a partially uploaded/deleted one after a crash or forced
 * close.
 */
export const LibrarySyncCheckpointBridge: React.FC = () => {
  const { user } = useAccountSync();
  const lastObservedBookCount = useRef(readBookCount());
  const verifyTimer = useRef<number | undefined>(undefined);
  const repairInFlight = useRef(false);

  useEffect(() => {
    if (!user || !db) return undefined;
    const uid = user.uid;
    const manifestRef = doc(db, 'users', uid, 'syncState', 'library');
    lastObservedBookCount.current = readBookCount();

    const verifyCheckpoint = async () => {
      const checkpoint = readCheckpoint(uid);
      if (!checkpoint || !navigator.onLine) return;
      try {
        // Counts alone cannot establish a complete backup. Compare actual
        // record IDs before advancing any checkpoint or manifest.
        const cloudSnapshot = await getDocs(collection(db!, 'users', uid, 'books'));
        const localIds = new Set(readBooks().map((book) => book.id).filter(Boolean));
        let cloudIds = new Set(cloudSnapshot.docs.map((entry) => entry.id));
        let uploadedBookCount = cloudIds.size;
        let identitiesMatch = localIds.size === cloudIds.size
          && [...localIds].every((id) => cloudIds.has(id));
        let complete = identitiesMatch;
        if (checkpoint.direction === 'shrink' && !identitiesMatch) {
          const verified = await reconcileShrinkCheckpoint(uid);
          uploadedBookCount = verified.cloudCount;
          identitiesMatch = verified.matches;
          complete = identitiesMatch;
          if (!complete) console.warn('Inkbound shrink checkpoint inventory differs from local IDs.', { extraIds: verified.extraIds, missingIds: verified.missingIds });
        }

        // If an older build stranded part of a growing library outside the
        // durable pending queue, repair only the cloud-missing IDs from the full
        // local working copy. Never run this for shrink checkpoints, and never
        // run it when the local device no longer has the expected full library.
        if (!complete
          && checkpoint.direction === 'grow'
          && readBookCount() >= checkpoint.expectedBookCount
          && !repairInFlight.current) {
          repairInFlight.current = true;
          try {
            const repaired = await repairMissingGrowthRecords(uid, checkpoint);
            if (repaired > 0) {
              const refreshed = await getDocs(collection(db!, 'users', uid, 'books'));
              cloudIds = new Set(refreshed.docs.map((entry) => entry.id));
              uploadedBookCount = cloudIds.size;
              complete = localIds.size === cloudIds.size && [...localIds].every((id) => cloudIds.has(id));
            }
          } finally {
            repairInFlight.current = false;
          }
        }

        // A newer local change may have replaced this checkpoint during async reads.
        if (readCheckpoint(uid)?.createdAt !== checkpoint.createdAt) return;
        await setDoc(manifestRef, {
          status: complete ? 'complete' : 'syncing',
          // A legacy count is not authoritative once every local record ID
          // has a matching cloud record ID. Rebase only on proven equality.
          expectedBookCount: complete ? uploadedBookCount : checkpoint.expectedBookCount,
          uploadedBookCount,
          syncDirection: checkpoint.direction ?? 'unknown',
          updatedAt: serverTimestamp(),
          ...(complete ? { completedAt: serverTimestamp() } : {}),
        }, { merge: true });
        if (complete) clearCheckpoint(uid);
      } catch (error) {
        console.warn('Inkbound library checkpoint verification will retry later.', error);
        // The local checkpoint remains durable and will be checked again later.
      }
    };

    const scheduleVerification = () => {
      if (verifyTimer.current !== undefined) window.clearTimeout(verifyTimer.current);
      verifyTimer.current = window.setTimeout(() => {
        verifyTimer.current = undefined;
        void verifyCheckpoint();
      }, VERIFY_DELAY_MS);
    };

    const recordExpectedLibrarySize = async (
      previousBookCount: number,
      expectedBookCount: number,
    ) => {
      const direction: LibraryCountDirection = expectedBookCount > previousBookCount ? 'grow' : 'shrink';
      const checkpoint: LocalCheckpoint = {
        previousBookCount,
        expectedBookCount,
        direction,
        createdAt: new Date().toISOString(),
      };
      writeCheckpoint(uid, checkpoint);
      try {
        await setDoc(manifestRef, {
          status: 'syncing',
          expectedBookCount,
          syncDirection: direction,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch {
        // Keep the local checkpoint; a later event/open can publish it.
      }
      scheduleVerification();
    };

    const handleLocalChange = (event: Event) => {
      const detail = (event as CustomEvent<LocalDataChangedDetail>).detail;
      if (detail?.keys && !detail.keys.includes(BOOKS_KEY)) return;
      const previousCount = lastObservedBookCount.current;
      const nextCount = readBookCount();
      if (nextCount === previousCount) return;
      lastObservedBookCount.current = nextCount;
      void recordExpectedLibrarySize(previousCount, nextCount);
    };

    window.addEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, handleLocalChange);
    const unsubscribeRuntimeResume = subscribeToRuntimeResume(() => {
      if (readCheckpoint(uid)) void verifyCheckpoint();
    });

    const existingCheckpoint = readCheckpoint(uid);
    if (existingCheckpoint) {
      void setDoc(manifestRef, {
        status: 'syncing',
        expectedBookCount: existingCheckpoint.expectedBookCount,
        syncDirection: existingCheckpoint.direction ?? 'unknown',
        updatedAt: serverTimestamp(),
      }, { merge: true }).catch(() => undefined);
      scheduleVerification();
    }

    return () => {
      window.removeEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, handleLocalChange);
      unsubscribeRuntimeResume();
      if (verifyTimer.current !== undefined) window.clearTimeout(verifyTimer.current);
    };
  }, [user?.uid]);

  return null;
};
