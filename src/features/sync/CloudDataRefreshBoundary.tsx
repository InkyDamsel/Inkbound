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
  const [hydrated, setHydrated] = useState(() => !user || getCloudDataRevision() > 0);

  useEffect(() => {
    if (!user) {
      setHydrated(true);
      return;
    }

    // The boundary has one responsibility now: hold the first signed-in render
    // until canonical cloud hydration has completed. Later cloud updates must NOT
    // remount the entire App. Remounting destroys navigation state, sidebar scroll,
    // dialogs, admin request state, and can make a single click appear to require
    // a second click while background sync/enrichment is active.
    const refresh = () => {
      recoverIncompleteLatestImport();
      reconcileRepeatedImportHistory(readStoredBooks());

      // Open the app exactly once after the first cloud-data revision arrives.
      // Subsequent revisions are handled by the feature/state owners themselves;
      // they do not recreate the application shell.
      setHydrated((current) => current || getCloudDataRevision() > 0);

      void synchronizeProfileMedia(user.uid).catch(() => {
        // Offline/background failures are expected. The durable media queue will
        // retry on the next foreground/online refresh without blocking the app.
      });
    };

    void synchronizeProfileMedia(user.uid).catch(() => undefined);
    if (getCloudDataRevision() > 0) setHydrated(true);

    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, refresh);
    const unsubscribeResume = subscribeToRuntimeResume(refresh);
    return () => {
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, refresh);
      unsubscribeResume();
    };
  }, [user?.uid]);

  if (user && !hydrated) {
    return <main className="grid min-h-[100dvh] place-items-center bg-[var(--ink-page)] px-6 text-center text-[var(--ink-ivory)]">Opening Inkbound...</main>;
  }

  return <>{children}</>;
};
