import React, { PropsWithChildren, useEffect, useState } from 'react';
import type { UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { readRuntimeJson } from '../../platform/runtimeStorage';
import { recoverIncompleteLatestImport } from '../import/recoverPendingImportBooks';
import { reconcileRepeatedImportHistory } from '../import/reconcileImportHistory';
import { getCloudDataRevision, INKBOUND_CLOUD_DATA_EVENT } from './cloudSyncEvents';

const BOOKS_STORAGE_KEY = 'inkbound_books';

function readStoredBooks(): UserBookRecord[] {
  return readRuntimeJson<UserBookRecord[]>(BOOKS_STORAGE_KEY, []);
}

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
      const historyChanged = reconcileRepeatedImportHistory(readStoredBooks());
      setRevision(getCloudDataRevision() + (repairedDelta !== 0 || historyChanged ? 1 : 0));
    };

    if (getCloudDataRevision() > 0) refresh();
    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, refresh);
    return () => window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, refresh);
  }, [user?.uid]);

  if (user && revision === 0) {
    return <main className="grid min-h-[100dvh] place-items-center bg-[var(--ink-page)] px-6 text-center text-[var(--ink-ivory)]">Opening Inkbound...</main>;
  }

  return <React.Fragment key={`${user?.uid ?? 'signed-out'}:${revision}`}>{children}</React.Fragment>;
};
