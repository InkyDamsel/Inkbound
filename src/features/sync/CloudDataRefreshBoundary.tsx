import React, { PropsWithChildren, useEffect, useRef, useState } from 'react';
import { INKBOUND_CLOUD_DATA_EVENT } from './cloudSyncEvents';

export const CloudDataRefreshBoundary: React.FC<PropsWithChildren> = ({ children }) => {
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

  return <React.Fragment key={revision}>{children}</React.Fragment>;
};
