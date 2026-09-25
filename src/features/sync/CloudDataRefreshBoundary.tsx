import React, { PropsWithChildren, useEffect, useState } from 'react';
import type { UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import { subscribeToRuntimeResume } from '../../platform/runtimeLifecycle';
import { getRuntimeStorage, readRuntimeJson } from '../../platform/runtimeStorage';
import { recoverIncompleteLatestImport } from '../import/recoverPendingImportBooks';
import { reconcileRepeatedImportHistory } from '../import/reconcileImportHistory';
import { synchronizeProfileMedia } from '../profile/profileMediaCloudSync';
import { INKBOUND_CLOUD_DATA_EVENT, notifyCloudDataUpdated } from './cloudSyncEvents';
import { FULL_RECONCILIATION_VERSION, fullReconciliationVersionKey, SYNC_STORAGE_KEYS } from './storageKeys';

const BOOKS_STORAGE_KEY = SYNC_STORAGE_KEYS.books;
const SESSIONS_STORAGE_KEY = SYNC_STORAGE_KEYS.sessions;
const PROFILE_STORAGE_KEY = SYNC_STORAGE_KEYS.profile;
const OWNER_UID_KEY = SYNC_STORAGE_KEYS.localOwnerUid;
const HYDRATION_REQUIRED_UID_KEY = SYNC_STORAGE_KEYS.hydrationRequiredOwnerUid;

function readStoredBooks(): UserBookRecord[] {
  return readRuntimeJson<UserBookRecord[]>(BOOKS_STORAGE_KEY, []);
}

function hasEstablishedLocalWorkingCopy(uid: string): boolean {
  try {
    const storage = getRuntimeStorage();
    if (storage.getItem(HYDRATION_REQUIRED_UID_KEY) === uid) return false;
    const raw = storage.getItem(BOOKS_STORAGE_KEY);
    if (!raw || !raw.trim().startsWith('[')) return false;
    const ownerUid = storage.getItem(OWNER_UID_KEY);
    if (ownerUid && ownerUid !== uid) return false;
    if (storage.getItem(fullReconciliationVersionKey(uid)) !== FULL_RECONCILIATION_VERSION) return false;
    if (ownerUid) return true;
    // Upgrade path for pre-owner-marker builds. A legacy non-empty library is a
    // real working copy; a bare [] can be App's fresh initialization and must
    // still wait for first-device hydration.
    return raw.trim() !== '[]';
  } catch {
    return false;
  }
}

export const CloudDataRefreshBoundary: React.FC<PropsWithChildren> = ({ children }) => {
  const { user } = useAccountSync();
  const uid = user?.uid;
  const localOnlyDevelopment = import.meta.env.DEV && !db;
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

    if (localOnlyDevelopment || hasEstablishedLocalWorkingCopy(uid)) setReadyUid(uid);
    else setReadyUid(null);

    // This boundary only gates a genuinely new/unhydrated account. Existing
    // devices are local-first and must open immediately even when there are no
    // remote changes to generate a cloud event. A cloud event by itself is not
    // enough to open the app: auxiliary sync can emit one before core library
    // hydration finishes, so readiness always comes from the canonical owner +
    // hydration marker state.
    const refresh = () => {
      recoverIncompleteLatestImport();
      reconcileRepeatedImportHistory(readStoredBooks());

      if (localOnlyDevelopment || hasEstablishedLocalWorkingCopy(uid)) setReadyUid(uid);

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
  }, [uid, localOnlyDevelopment]);

  if (uid && readyUid !== uid) {
    return <main className="grid min-h-[100dvh] place-items-center bg-[var(--ink-page)] px-6 text-center text-[var(--ink-ivory)]">Opening Inkbound...</main>;
  }

  return <>{children}</>;
};
