import React, { useEffect, useRef } from 'react';
import { purgeUnverifiedLegacyImportMetadata } from '../import/purgeLegacyImportMetadata';
import { notifyCloudDataUpdated } from './cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from './storageKeys';

/**
 * One-time legacy import cleanup.
 *
 * This bridge is intentionally mounted only inside BrowserStorageHydrationGate.
 * Large web libraries may live in IndexedDB and must be restored before any
 * migration reads or writes the canonical library. Running this from the app
 * bootstrap can incorrectly mark the migration complete against an empty
 * pre-hydration localStorage view.
 */
export const LegacyImportMetadataPurgeBridge: React.FC = () => {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const purged = purgeUnverifiedLegacyImportMetadata();
    if (purged > 0) notifyCloudDataUpdated([SYNC_STORAGE_KEYS.books]);
  }, []);

  return null;
};
