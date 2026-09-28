import React, { useEffect, useRef } from 'react';
import { purgeUnverifiedLegacyImportMetadata } from '../import/purgeLegacyImportMetadata';

/**
 * One-time legacy import cleanup.
 *
 * This bridge is intentionally mounted only inside BrowserStorageHydrationGate.
 * Large web libraries may live in IndexedDB and must be restored before any
 * migration reads or writes the canonical library. Running this from the app
 * bootstrap can incorrectly mark the migration complete against an empty
 * pre-hydration browser-storage view.
 */
export const LegacyImportMetadataPurgeBridge: React.FC = () => {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    purgeUnverifiedLegacyImportMetadata();
  }, []);

  return null;
};
