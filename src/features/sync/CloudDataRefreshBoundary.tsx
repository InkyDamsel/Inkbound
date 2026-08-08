import React, { PropsWithChildren, useEffect, useRef, useState } from 'react';
import { useAccountSync } from '../../context/AccountSyncContext';
import { INKBOUND_CLOUD_DATA_EVENT } from './cloudSyncEvents';

export const CloudDataRefreshBoundary: React.FC<PropsWithChildren> = ({ children }) => {
  const { user } = useAccountSync();
  const [revision, setRevision] = useState(0);
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    const handleCloudDataUpdate = () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        setRevision((current) => current + 1);
        refreshTimer.current = null;
      }, 120);
    };

    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, handleCloudDataUpdate);
    return () => {
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, handleCloudDataUpdate);
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    };
  }, []);

  // AccountSyncContext clears account-owned localStorage before Firebase finishes
  // signing out. Keying by the authenticated UID forces App/Profile to remount
  // immediately afterward, so no previous reader's in-memory data stays visible.
  return (
    <React.Fragment key={`${user?.uid ?? 'signed-out'}:${revision}`}>
      {children}
    </React.Fragment>
  );
};
