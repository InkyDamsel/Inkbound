import React, { PropsWithChildren, useEffect } from 'react';
import type { UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { subscribeToRuntimeResume } from '../../platform/runtimeLifecycle';
import { getRuntimeStorage, readRuntimeJson } from '../../platform/runtimeStorage';
import { recoverIncompleteLatestImport } from '../import/recoverPendingImportBooks';
import { reconcileRepeatedImportHistory } from '../import/reconcileImportHistory';
import { synchronizeProfileMedia } from '../profile/profileMediaCloudSync';
import { INKBOUND_CLOUD_DATA_EVENT, notifyCloudDataUpdated } from './cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from './storageKeys';

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
    if (ownerUid) return ownerUid === uid;
    return raw.trim() !== '[]';
  } catch {
    return false;
  }
}

/**
 * Cloud hydration is background work. A fresh device with a very large account
 * can take seconds (or longer) to download and merge its library, and the reader
 * must never be trapped behind "Opening Inkbound" while that work completes.
 *
 * The boundary now always renders its children. It still performs recovery and
 * maintenance after hydration events, but expensive whole-library maintenance is
 * coalesced into idle time so a 50k-book account does not freeze first paint.
 */
export const CloudDataRefreshBoundary: React.FC<PropsWithChildren> = ({ children }) => {
  const { user } = useAccountSync();
  const uid = user?.uid;

  useEffect(() => {
    if (!uid) {
      notifyCloudDataUpdated([BOOKS_STORAGE_KEY, SESSIONS_STORAGE_KEY, PROFILE_STORAGE_KEY]);
      return undefined;
    }

    let cancelled = false;
    let maintenanceScheduled = false;
    let idleId: number | undefined;
    let timerId: number | undefined;

    const runMaintenance = () => {
      maintenanceScheduled = false;
      idleId = undefined;
      timerId = undefined;
      if (cancelled) return;

      recoverIncompleteLatestImport();
      reconcileRepeatedImportHistory(readStoredBooks());
      void synchronizeProfileMedia(uid).catch(() => undefined);
    };

    const scheduleMaintenance = () => {
      if (cancelled || maintenanceScheduled) return;
      maintenanceScheduled = true;

      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(runMaintenance, { timeout: 3000 });
      } else {
        timerId = window.setTimeout(runMaintenance, 1000);
      }
    };

    const refresh = () => {
      // Readiness is diagnostic only now; hydration must never own the UI gate.
      if (hasEstablishedLocalWorkingCopy(uid)) {
        console.info('[Inkbound startup] Local account working copy is ready.');
      }
      scheduleMaintenance();
    };

    scheduleMaintenance();
    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, refresh);
    const unsubscribeResume = subscribeToRuntimeResume(refresh);

    return () => {
      cancelled = true;
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, refresh);
      unsubscribeResume();
      if (idleId !== undefined && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [uid]);

  return <>{children}</>;
};
