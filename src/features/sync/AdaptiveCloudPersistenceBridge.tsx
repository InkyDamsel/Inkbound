import React, { useCallback, useEffect, useState } from 'react';
import { useAccountSync } from '../../context/AccountSyncContext';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import {
  INKBOUND_CLOUD_DATA_EVENT,
  INKBOUND_LOCAL_DATA_CHANGED_EVENT,
  type CloudDataUpdatedDetail,
  type LocalDataChangedDetail,
} from './cloudSyncEvents';
import { hasEstablishedLocalWorkingCopy } from './cloudHydrationState';
import { CostSafeCloudPersistenceBridge } from './CostSafeCloudPersistenceBridge';
import { FullCloudReconciliationBridge } from './FullCloudReconciliationBridge';
import { OneShotCloudHydrationBridge } from './OneShotCloudHydrationBridge';
import {
  FULL_RECONCILIATION_VERSION,
  fullReconciliationVersionKey,
  SYNC_STORAGE_KEYS,
} from './storageKeys';

const BOOKS_KEY = SYNC_STORAGE_KEYS.books;

function hasCompletedFullReconciliation(uid: string): boolean {
  try {
    return getRuntimeStorage().getItem(fullReconciliationVersionKey(uid)) === FULL_RECONCILIATION_VERSION;
  } catch {
    return false;
  }
}

/**
 * Existing devices keep a local-first working copy, but they must first perform
 * the one-time Build 27 full reconciliation. Delta sync can only see records
 * newer than its cursor, so an older stale browser record would otherwise never
 * be reconsidered even though newly-added Android books sync correctly.
 *
 * New devices still use the one-shot cloud restore. Whether local state is
 * authoritative is owned centrally by cloudHydrationState.ts so every sync path
 * makes the same decision about fresh empty devices versus verified empty
 * libraries.
 */
export const AdaptiveCloudPersistenceBridge: React.FC = () => {
  const { user } = useAccountSync();
  const uid = user?.uid;
  const [localLibraryReady, setLocalLibraryReady] = useState(false);
  const [fullReconciliationComplete, setFullReconciliationComplete] = useState(false);

  useEffect(() => {
    if (!uid) {
      setLocalLibraryReady(false);
      setFullReconciliationComplete(false);
      return undefined;
    }

    const refreshReadiness = () => {
      setLocalLibraryReady(hasEstablishedLocalWorkingCopy(uid));
      setFullReconciliationComplete(hasCompletedFullReconciliation(uid));
    };
    refreshReadiness();

    const checkForLibrary = (event: Event) => {
      const detail = (event as CustomEvent<CloudDataUpdatedDetail | LocalDataChangedDetail>).detail;
      if (detail?.keys && !detail.keys.includes(BOOKS_KEY)) return;
      refreshReadiness();
    };

    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, checkForLibrary);
    window.addEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, checkForLibrary);
    return () => {
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, checkForLibrary);
      window.removeEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, checkForLibrary);
    };
  }, [uid]);

  const handleFullReconciliationComplete = useCallback(() => {
    setFullReconciliationComplete(true);
  }, []);

  if (!uid) return null;
  if (!localLibraryReady) return <OneShotCloudHydrationBridge />;
  if (!fullReconciliationComplete) {
    return <FullCloudReconciliationBridge onComplete={handleFullReconciliationComplete} />;
  }
  return <CostSafeCloudPersistenceBridge />;
};
