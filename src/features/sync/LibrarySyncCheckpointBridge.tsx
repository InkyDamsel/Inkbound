import React, { useEffect, useRef } from 'react';
import {
  collection,
  doc,
  getCountFromServer,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
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

interface LocalCheckpoint {
  expectedBookCount: number;
  createdAt: string;
}

function readBookCount(): number {
  try {
    const raw = getRuntimeStorage().getItem(BOOKS_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
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
 * Records the expected size of a reader's library before a large local change
 * begins syncing to Firestore. Recovery code can then distinguish a complete
 * cloud library from a partially uploaded/deleted one after a crash or forced
 * close.
 */
export const LibrarySyncCheckpointBridge: React.FC = () => {
  const { user } = useAccountSync();
  const lastObservedBookCount = useRef(readBookCount());
  const verifyTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!user || !db) return undefined;
    const uid = user.uid;
    const manifestRef = doc(db, 'users', uid, 'syncState', 'library');
    lastObservedBookCount.current = readBookCount();

    const verifyCheckpoint = async () => {
      const checkpoint = readCheckpoint(uid);
      if (!checkpoint || !navigator.onLine) return;
      try {
        const countSnapshot = await getCountFromServer(collection(db!, 'users', uid, 'books'));
        const uploadedBookCount = countSnapshot.data().count;
        // Equality is required. Using >= incorrectly declared deletion batches
        // complete while stale cloud books still existed (especially expected 0).
        const complete = uploadedBookCount === checkpoint.expectedBookCount;
        await setDoc(manifestRef, {
          status: complete ? 'complete' : 'syncing',
          expectedBookCount: checkpoint.expectedBookCount,
          uploadedBookCount,
          updatedAt: serverTimestamp(),
          ...(complete ? { completedAt: serverTimestamp() } : {}),
        }, { merge: true });
        if (complete) clearCheckpoint(uid);
      } catch {
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
    const unsubscribeRuntimeResume = subscribeToRuntimeResume(() => {
      if (readCheckpoint(uid)) void verifyCheckpoint();
    });

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
      unsubscribeRuntimeResume();
      if (verifyTimer.current !== undefined) window.clearTimeout(verifyTimer.current);
    };
  }, [user?.uid]);

  return null;
};
