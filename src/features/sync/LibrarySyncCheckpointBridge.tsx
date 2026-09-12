import React, { useEffect, useRef } from 'react';
import {
  collection,
  doc,
  getCountFromServer,
  getDocsFromServer,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import {
  INKBOUND_LOCAL_DATA_CHANGED_EVENT,
  type LocalDataChangedDetail,
} from './cloudSyncEvents';

const BOOKS_KEY = 'inkbound_books';
const CHECKPOINT_KEY_PREFIX = 'inkbound_library_sync_checkpoint_v1_';
const VERIFY_DELAY_MS = 15000;
const REPAIR_BATCH_SIZE = 50;

interface LocalCheckpoint {
  expectedBookCount: number;
  createdAt: string;
}

function readLocalBooks(): UserBookRecord[] {
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
  return readLocalBooks().length;
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

async function repairMissingCloudBooks(
  uid: string,
  checkpoint: LocalCheckpoint,
  localBooks: UserBookRecord[],
): Promise<number> {
  if (!db || localBooks.length !== checkpoint.expectedBookCount) return 0;

  const booksRef = collection(db, 'users', uid, 'books');
  const cloudSnapshot = await getDocsFromServer(booksRef);
  if (cloudSnapshot.size >= checkpoint.expectedBookCount) return 0;

  const cloudIds = new Set(cloudSnapshot.docs.map((item) => item.id));
  const missingBooks = localBooks.filter((book) => !cloudIds.has(book.id));
  if (!missingBooks.length) return 0;

  // A checkpoint is created from an explicit local library-size change. If the
  // server still contains fewer records than that exact checkpointed library,
  // the upload was incomplete. Repair only records that are completely absent
  // from Firestore; never overwrite an existing cloud record here.
  const clientUpdatedAt = new Date().toISOString();
  for (let index = 0; index < missingBooks.length; index += REPAIR_BATCH_SIZE) {
    const batch = missingBooks.slice(index, index + REPAIR_BATCH_SIZE);
    await Promise.all(batch.map((book) => setDoc(
      doc(db!, 'users', uid, 'books', book.id),
      {
        data: book,
        updatedAt: serverTimestamp(),
        clientUpdatedAt,
      },
      { merge: true },
    )));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  return missingBooks.length;
}

/**
 * Records the expected size of a reader's library before a large local change
 * begins syncing to Firestore. If a device checkpoint proves that Firestore is
 * incomplete, this bridge can safely backfill records that are entirely absent
 * from the cloud without replacing any existing cloud version.
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

    const verifyCheckpoint = async () => {
      const checkpoint = readCheckpoint(uid);
      if (!checkpoint || !navigator.onLine || repairInFlight.current) return;

      repairInFlight.current = true;
      try {
        const localBooks = readLocalBooks();
        const initialCountSnapshot = await getCountFromServer(collection(db!, 'users', uid, 'books'));
        const initialUploadedBookCount = initialCountSnapshot.data().count;

        let repairedMissingBookCount = 0;
        if (
          initialUploadedBookCount < checkpoint.expectedBookCount
          && localBooks.length === checkpoint.expectedBookCount
        ) {
          repairedMissingBookCount = await repairMissingCloudBooks(uid, checkpoint, localBooks);
        }

        const finalCountSnapshot = repairedMissingBookCount > 0
          ? await getCountFromServer(collection(db!, 'users', uid, 'books'))
          : initialCountSnapshot;
        const uploadedBookCount = finalCountSnapshot.data().count;
        const complete = uploadedBookCount >= checkpoint.expectedBookCount;

        await setDoc(manifestRef, {
          status: complete ? 'complete' : 'syncing',
          expectedBookCount: checkpoint.expectedBookCount,
          uploadedBookCount,
          updatedAt: serverTimestamp(),
          ...(repairedMissingBookCount > 0 ? {
            repairedMissingBookCount,
            repairedAt: serverTimestamp(),
          } : {}),
          ...(complete ? { completedAt: serverTimestamp() } : {}),
        }, { merge: true });

        if (complete) clearCheckpoint(uid);
      } catch {
        // The local checkpoint remains durable and will be checked again later.
      } finally {
        repairInFlight.current = false;
      }
    };

    const scheduleVerification = () => {
      if (verifyTimer.current !== undefined) window.clearTimeout(verifyTimer.current);
      verifyTimer.current = window.setTimeout(() => {
        verifyTimer.current = undefined;
        void verifyCheckpoint();
      }, VERIFY_DELAY_MS);
    };

    const recordExpectedLibrarySize = async (expectedBookCount: number) => {
      const checkpoint: LocalCheckpoint = {
        expectedBookCount,
        createdAt: new Date().toISOString(),
      };
      writeCheckpoint(uid, checkpoint);
      try {
        await setDoc(manifestRef, {
          status: 'syncing',
          expectedBookCount,
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
      const nextCount = readBookCount();
      if (nextCount === lastObservedBookCount.current) return;
      lastObservedBookCount.current = nextCount;
      void recordExpectedLibrarySize(nextCount);
    };

    window.addEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, handleLocalChange);

    const existingCheckpoint = readCheckpoint(uid);
    if (existingCheckpoint) {
      void setDoc(manifestRef, {
        status: 'syncing',
        expectedBookCount: existingCheckpoint.expectedBookCount,
        updatedAt: serverTimestamp(),
      }, { merge: true }).catch(() => undefined);
      scheduleVerification();
    }

    return () => {
      window.removeEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, handleLocalChange);
      if (verifyTimer.current !== undefined) window.clearTimeout(verifyTimer.current);
    };
  }, [user?.uid]);

  return null;
};
