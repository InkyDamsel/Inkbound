import React, { PropsWithChildren, useEffect, useState } from 'react';
import type { UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { subscribeToRuntimeResume } from '../../platform/runtimeLifecycle';
import { readRuntimeJson } from '../../platform/runtimeStorage';
import { recoverIncompleteLatestImport } from '../import/recoverPendingImportBooks';
import { reconcileRepeatedImportHistory } from '../import/reconcileImportHistory';
import { synchronizeProfileMedia } from '../profile/profileMediaCloudSync';
import {
  getCloudDataRevision,
  INKBOUND_CLOUD_DATA_EVENT,
} from './cloudSyncEvents';

const BOOKS_STORAGE_KEY = 'inkbound_books';

function readStoredBooks(): UserBookRecord[] {
  return readRuntimeJson<UserBookRecord[]>(BOOKS_STORAGE_KEY, []);
}

export const CloudDataRefreshBoundary: React.FC<PropsWithChildren> = ({ children }) => {
  const { user } = useAccountSync();
  const [initialCloudRevision, setInitialCloudRevision] = useState(() => getCloudDataRevision());

  useEffect(() => {
    if (!user) {
      setInitialCloudRevision(getCloudDataRevision());
      return;
    }

    // This boundary now has one responsibility: hold the FIRST signed-in render
    // until canonical cloud hydration is available. Later cloud updates must not
    // remount App. The previous keyed remount destroyed navigation/sidebar state,
    // admin request state, dialogs, and other transient UI whenever books or
    // sessions synced in the background.
    const refresh = () => {
      recoverIncompleteLatestImport();
      reconcileRepeatedImportHistory(readStoredBooks());

      // Capture the first non-zero cloud revision only. Once App is mounted for
      // this signed-in session, later revisions stay inside their feature/state
      // owners rather than recreating the entire application shell.
      setInitialCloudRevision((current) => current > 0 ? current : getCloudDataRevision());

      void synchronizeProfileMedia(user.uid).catch(() => {
        // Offline/background failures are expected. The durable media queue will
        // retry on the next foreground/online refresh without blocking the app.
      });
    };

    void synchronizeProfileMedia(user.uid).catch(() => undefined);
    const currentRevision = getCloudDataRevision();
    if (currentRevision > 0) setInitialCloudRevision((current) => current > 0 ? current : currentRevision);

    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, refresh);
    const unsubscribeResume = subscribeToRuntimeResume(refresh);
    return () => {
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, refresh);
      unsubscribeResume();
    };
  }, [user?.uid]);

  if (user && initialCloudRevision === 0) {
    return <main className="grid min-h-[100dvh] place-items-center bg-[var(--ink-page)] px-6 text-center text-[var(--ink-ivory)]">Opening Inkbound...</main>;
  }

  return <>{children}</>;
};
