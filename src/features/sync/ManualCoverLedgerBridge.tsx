import React, { useEffect, useRef } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import {
  INKBOUND_CLOUD_DATA_EVENT,
  INKBOUND_LOCAL_DATA_CHANGED_EVENT,
  type CloudDataUpdatedDetail,
  type LocalDataChangedDetail,
} from './cloudSyncEvents';
import { manualCoverLedgerBaselineKey, SYNC_STORAGE_KEYS } from './storageKeys';

const BOOKS_KEY = SYNC_STORAGE_KEYS.books;

interface ManualCoverLedgerEntry {
  bookId: string;
  editionId: string;
  coverUrl: string;
  title: string;
  author: string;
}

type PersistedSignatureState = Record<string, string>;

function readBooks(): UserBookRecord[] {
  try {
    const raw = getRuntimeStorage().getItem(BOOKS_KEY);
    return raw ? JSON.parse(raw) as UserBookRecord[] : [];
  } catch {
    return [];
  }
}

function collectManualAssignments(books: UserBookRecord[]): ManualCoverLedgerEntry[] {
  return books.flatMap((book) => {
    const activeEdition = book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];
    if (!activeEdition || activeEdition.externalSource !== 'manual' || !activeEdition.coverUrl?.trim()) return [];
    return [{
      bookId: book.id,
      editionId: activeEdition.id,
      coverUrl: activeEdition.coverUrl.trim(),
      title: book.work.title,
      author: book.work.author,
    }];
  });
}

function baselineKey(uid: string) {
  return manualCoverLedgerBaselineKey(uid);
}

function readPersistedSignatures(uid: string): Map<string, string> {
  try {
    const raw = getRuntimeStorage().getItem(baselineKey(uid));
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as PersistedSignatureState;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function writePersistedSignatures(uid: string, signatures: Map<string, string>) {
  const state: PersistedSignatureState = {};
  signatures.forEach((signature, bookId) => {
    state[bookId] = signature;
  });
  getRuntimeStorage().setItem(baselineKey(uid), JSON.stringify(state));
}

/**
 * Manual cover choices are user-owned data, not disposable book metadata.
 * Keep a tiny independent Firestore ledger so an older library recovery point
 * can restore book records without rolling back newer manual cover assignments.
 *
 * The local signature baseline is durable across launches. Opening Inkbound must
 * not rewrite every manual-cover ledger document; only a genuinely new/changed
 * manual cover is written. A successful write checkpoints its signature locally.
 */
export const ManualCoverLedgerBridge: React.FC = () => {
  const { user } = useAccountSync();
  const persistedSignatures = useRef(new Map<string, string>());
  const running = useRef(false);
  const rerunRequested = useRef(false);

  useEffect(() => {
    if (!user || !db) return undefined;
    const uid = user.uid;
    persistedSignatures.current = readPersistedSignatures(uid);

    const persist = async () => {
      if (running.current) {
        rerunRequested.current = true;
        return;
      }
      running.current = true;
      try {
        const assignments = collectManualAssignments(readBooks());
        let baselineChanged = false;

        for (const assignment of assignments) {
          const signature = `${assignment.editionId}|${assignment.coverUrl}`;
          if (persistedSignatures.current.get(assignment.bookId) === signature) continue;

          await setDoc(doc(db, 'users', uid, 'manualCoverAssignments', assignment.bookId), {
            ...assignment,
            clientUpdatedAt: new Date().toISOString(),
            updatedAt: serverTimestamp(),
          }, { merge: true });

          persistedSignatures.current.set(assignment.bookId, signature);
          baselineChanged = true;
        }

        if (baselineChanged) writePersistedSignatures(uid, persistedSignatures.current);
      } catch (error) {
        console.error('Inkbound could not persist the manual cover ledger.', error);
      } finally {
        running.current = false;
        if (rerunRequested.current) {
          rerunRequested.current = false;
          void persist();
        }
      }
    };

    const onLocalChange = (event: Event) => {
      const detail = (event as CustomEvent<LocalDataChangedDetail>).detail;
      if (detail?.keys?.includes(BOOKS_KEY)) void persist();
    };
    const onCloudChange = (event: Event) => {
      const detail = (event as CustomEvent<CloudDataUpdatedDetail>).detail;
      if (detail?.keys?.includes(BOOKS_KEY)) void persist();
    };

    // This startup pass is now cheap after the first successful checkpoint: it
    // compares local signatures and performs zero Firestore writes when nothing
    // changed since the prior launch.
    void persist();
    window.addEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, onLocalChange);
    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, onCloudChange);
    return () => {
      window.removeEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, onLocalChange);
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, onCloudChange);
    };
  }, [user?.uid]);

  return null;
};
