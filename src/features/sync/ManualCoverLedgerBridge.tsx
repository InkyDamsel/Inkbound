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

const BOOKS_KEY = 'inkbound_books';

interface ManualCoverLedgerEntry {
  bookId: string;
  editionId: string;
  coverUrl: string;
  title: string;
  author: string;
}

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

/**
 * Manual cover choices are user-owned data, not disposable book metadata.
 * Keep a tiny independent Firestore ledger so an older library recovery point
 * can restore book records without rolling back newer manual cover assignments.
 * Ledger entries are intentionally never removed by ordinary metadata changes;
 * a transient sync regression must not erase the user's last explicit choice.
 */
export const ManualCoverLedgerBridge: React.FC = () => {
  const { user } = useAccountSync();
  const persistedSignatures = useRef(new Map<string, string>());
  const running = useRef(false);
  const rerunRequested = useRef(false);

  useEffect(() => {
    if (!user || !db) return undefined;
    const uid = user.uid;
    persistedSignatures.current.clear();

    const persist = async () => {
      if (running.current) {
        rerunRequested.current = true;
        return;
      }
      running.current = true;
      try {
        const assignments = collectManualAssignments(readBooks());
        for (const assignment of assignments) {
          const signature = `${assignment.editionId}|${assignment.coverUrl}`;
          if (persistedSignatures.current.get(assignment.bookId) === signature) continue;
          await setDoc(doc(db, 'users', uid, 'manualCoverAssignments', assignment.bookId), {
            ...assignment,
            clientUpdatedAt: new Date().toISOString(),
            updatedAt: serverTimestamp(),
          }, { merge: true });
          persistedSignatures.current.set(assignment.bookId, signature);
        }
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
