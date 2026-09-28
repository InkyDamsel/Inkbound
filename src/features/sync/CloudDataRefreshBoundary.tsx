import React, { PropsWithChildren, useEffect, useState } from 'react';
import type { UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db, readDb } from '../../lib/firebase';
import { subscribeToRuntimeResume } from '../../platform/runtimeLifecycle';
import { getRuntimeStorage, readRuntimeJson } from '../../platform/runtimeStorage';
import { reconcileRepeatedImportHistory } from '../import/reconcileImportHistory';
import { synchronizeProfileMedia } from '../profile/profileMediaCloudSync';
import { INKBOUND_CLOUD_DATA_EVENT, notifyCloudDataUpdated } from './cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from './storageKeys';
import { hasEstablishedLocalWorkingCopy } from './syncReadiness';

const BOOKS_STORAGE_KEY = SYNC_STORAGE_KEYS.books;
const SESSIONS_STORAGE_KEY = SYNC_STORAGE_KEYS.sessions;
const PROFILE_STORAGE_KEY = SYNC_STORAGE_KEYS.profile;
const OWNER_UID_KEY = SYNC_STORAGE_KEYS.localOwnerUid;
const HYDRATION_REQUIRED_UID_KEY = SYNC_STORAGE_KEYS.hydrationRequiredOwnerUid;

function readStoredBooks(): UserBookRecord[] {
  return readRuntimeJson<UserBookRecord[]>(BOOKS_STORAGE_KEY, []);
}

export const CloudDataRefreshBoundary: React.FC<PropsWithChildren> = ({ children }) => {
  const { user } = useAccountSync();
  const uid = user?.uid;
  const [readyUid, setReadyUid] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setReadyUid(null);
      // AccountSync removes signed-in records from runtime storage before Auth
      // transitions to signed-out. Refresh App's in-memory core collections now
      // so the previous reader's books/sessions cannot remain visible until a
      // reload even though the durable device copy has already been cleared.
      notifyCloudDataUpdated([BOOKS_STORAGE_KEY, SESSIONS_STORAGE_KEY, PROFILE_STORAGE_KEY]);
      return undefined;
    }

    if (hasEstablishedLocalWorkingCopy(uid, { requireFullReconciliation: !Boolean(readDb && !db) })) setReadyUid(uid);
    else setReadyUid(null);

    // This boundary only gates a genuinely new/unhydrated account. Existing
    // devices are local-first and must open immediately even when there are no
    // remote changes to generate a cloud event. A cloud event by itself is not
    // enough to open the app: auxiliary sync can emit one before core library
    // hydration finishes, so readiness always comes from the canonical owner +
    // hydration marker state.
    const refresh = () => {
      reconcileRepeatedImportHistory(readStoredBooks());

      if (hasEstablishedLocalWorkingCopy(uid, { requireFullReconciliation: !Boolean(readDb && !db) })) setReadyUid(uid);

      void synchronizeProfileMedia(uid).catch(() => {
        // Offline/background failures are expected. The durable media queue will
        // retry on the next foreground/online refresh without blocking the app.
      });
    };

    void synchronizeProfileMedia(uid).catch(() => undefined);
    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, refresh);
    const unsubscribeResume = subscribeToRuntimeResume(refresh);
    return () => {
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, refresh);
      unsubscribeResume();
    };
  }, [uid]);

  if (uid && readyUid !== uid) {
    return <main className="grid min-h-[100dvh] place-items-center bg-[var(--ink-page)] px-6 text-center text-[var(--ink-ivory)]">Opening Inkbound...</main>;
  }

  return <>{children}</>;
};
