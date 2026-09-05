import React, { useEffect, useState } from 'react';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import {
  INKBOUND_CLOUD_DATA_EVENT,
  INKBOUND_LOCAL_DATA_CHANGED_EVENT,
  type CloudDataUpdatedDetail,
  type LocalDataChangedDetail,
} from './cloudSyncEvents';
import { CloudPersistenceBridge } from './CloudPersistenceBridge';
import { CostSafeCloudPersistenceBridge } from './CostSafeCloudPersistenceBridge';

const BOOKS_KEY = 'inkbound_books';

function hasLocalLibrary(): boolean {
  try {
    const raw = getRuntimeStorage().getItem(BOOKS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

/**
 * Existing devices already have a durable local working copy, so they should not
 * pay for a full Firestore library read every time Inkbound opens. New/empty
 * devices temporarily use the legacy hydration bridge to restore their saved
 * library. As soon as a local library exists, the expensive collection listeners
 * are removed and local-first cost-safe persistence takes over.
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
    : <CloudPersistenceBridge />;
};
