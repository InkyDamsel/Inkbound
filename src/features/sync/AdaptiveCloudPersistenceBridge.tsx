import React, { useEffect, useState } from 'react';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import {
  INKBOUND_CLOUD_DATA_EVENT,
  INKBOUND_LOCAL_DATA_CHANGED_EVENT,
  type CloudDataUpdatedDetail,
  type LocalDataChangedDetail,
} from './cloudSyncEvents';
import { CostSafeCloudPersistenceBridge } from './CostSafeCloudPersistenceBridge';
import { OneShotCloudHydrationBridge } from './OneShotCloudHydrationBridge';
import { SYNC_STORAGE_KEYS } from './storageKeys';

const BOOKS_KEY = SYNC_STORAGE_KEYS.books;

function hasLocalLibrary(): boolean {
  try {
    const raw = getRuntimeStorage().getItem(BOOKS_KEY);
    if (!raw) return false;
    const trimmed = raw.trim();
    // Avoid parsing a 40k+ book JSON payload just to answer whether a local
    // working library exists. The actual library owner will parse it once.
    return trimmed.startsWith('[') && trimmed !== '[]';
  } catch {
    return false;
  }
}

/**
 * Existing devices already have a durable local working copy, so they should not
 * pay for a full Firestore library read every time Inkbound opens. New/empty
 * devices get one guarded, one-shot cloud restore with no collection listeners.
 * As soon as a local library exists, local-first cost-safe persistence takes over.
 */
export const AdaptiveCloudPersistenceBridge: React.FC = () => {
  const [localLibraryReady, setLocalLibraryReady] = useState(hasLocalLibrary);

  useEffect(() => {
    if (localLibraryReady) return undefined;

    const checkForLibrary = (event: Event) => {
      const detail = (event as CustomEvent<CloudDataUpdatedDetail | LocalDataChangedDetail>).detail;
      if (detail?.keys && !detail.keys.includes(BOOKS_KEY)) return;
      if (hasLocalLibrary()) setLocalLibraryReady(true);
    };

    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, checkForLibrary);
    window.addEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, checkForLibrary);
    return () => {
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, checkForLibrary);
      window.removeEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, checkForLibrary);
    };
  }, [localLibraryReady]);

  return localLibraryReady
    ? <CostSafeCloudPersistenceBridge />
    : <OneShotCloudHydrationBridge />;
};
