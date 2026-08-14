import React, { PropsWithChildren, useEffect, useState } from 'react';
import { useAccountSync } from '../../context/AccountSyncContext';
import { recoverIncompleteLatestImport } from '../import/recoverPendingImportBooks';
import { getCloudDataRevision, INKBOUND_CLOUD_DATA_EVENT } from './cloudSyncEvents';

export const CloudDataRefreshBoundary: React.FC<PropsWithChildren> = ({ children }) => {
  const { user } = useAccountSync();
  const [revision, setRevision] = useState(() => getCloudDataRevision());

  useEffect(() => {
    if (!user) {
      setRevision(getCloudDataRevision());
      return;
    }

    const refresh = () => {
      const repairedDelta = recoverIncompleteLatestImport();
      // Any repair changes the persisted library, whether books were restored or
      // duplicate recovery rows were removed. Force App to remount from that
      // corrected source of truth in either direction.
      setRevision(getCloudDataRevision() + (repairedDelta !== 0 ? 1 : 0));
    };

    if (getCloudDataRevision() > 0) refresh();
    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, refresh);
    return () => window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, refresh);
  }, [user?.uid]);

  if (user && revision === 0) {
    return <main className="grid min-h-screen place-items-center bg-[var(--ink-page)] text-[var(--ink-ivory)]">Opening Inkbound...</main>;
  }

  return <React.Fragment key={`${user?.uid ?? 'signed-out'}:${revision}`}>{children}</React.Fragment>;
};
