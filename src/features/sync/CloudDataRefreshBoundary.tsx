import React, { PropsWithChildren, useEffect, useRef, useState } from 'react';
import { useAccountSync } from '../../context/AccountSyncContext';
import { recoverPendingImportBooks } from '../import/recoverPendingImportBooks';
import { getCloudDataRevision, INKBOUND_CLOUD_DATA_EVENT } from './cloudSyncEvents';

export const CloudDataRefreshBoundary: React.FC<PropsWithChildren> = ({ children }) => {
  const { user } = useAccountSync();
  const [revision, setRevision] = useState(() => getCloudDataRevision());
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!user) {
      setRevision(getCloudDataRevision());
      return undefined;
    }

    const finishRefresh = () => {
      // Older builds could lose imported fallback records if an import finished
      // while the initial cloud snapshot was still loading. Restore only missing
      // rows from the durable awaiting-metadata list after hydration has settled.
      recoverPendingImportBooks();
      setRevision(getCloudDataRevision());
    };

    const handleCloudDataUpdate = () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        finishRefresh();
        refreshTimer.current = null;
      }, 120);
    };

    if (getCloudDataRevision() > 0) finishRefresh();
    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, handleCloudDataUpdate);
    return () => {
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, handleCloudDataUpdate);
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    };
  }, [user?.uid]);

  // Signed-in screens wait for the first cloud hydration pass before mounting.
  // This prevents a large local import from racing a stale account snapshot.
  if (user && revision === 0) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--ink-page)] px-6 text-center">
        <div className="max-w-sm">
          <div className="mx-auto h-9 w-9 animate-pulse rounded-full border border-[var(--ink-border)] bg-[var(--ink-surface-soft)]" />
          <p className="mt-4 font-serif text-xl text-[var(--ink-ivory)]">Opening Inkbound</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Restoring your account library before changes are allowed...</p>
        </div>
      </main>
    );
  }

  return (
    <React.Fragment key={`${user?.uid ?? 'signed-out'}:${revision}`}>
      {children}
    </React.Fragment>
  );
};
