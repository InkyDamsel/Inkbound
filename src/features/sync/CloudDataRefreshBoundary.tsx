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
  type CloudDataUpdatedDetail,
} from './cloudSyncEvents';

const BOOKS_STORAGE_KEY = 'inkbound_books';
const SESSIONS_STORAGE_KEY = 'inkbound_sessions';

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

    const refresh = (event?: Event) => {
      const repairedDelta = recoverIncompleteLatestImport();
      const historyChanged = reconcileRepeatedImportHistory(readStoredBooks());
      const detail = event
        ? (event as CustomEvent<CloudDataUpdatedDetail>).detail
        : undefined;
      const canonicalCollectionsChanged = detail?.keys?.some(
        (key) => key === BOOKS_STORAGE_KEY || key === SESSIONS_STORAGE_KEY,
      ) ?? false;

      // ProfileScreen already consumes profile cloud events directly. Remounting
      // the entire App for a profile-only update destroys transient mobile shell
      // state (for example an open More menu/navigation transition) and can bounce
      // the reader back to the previous screen just after selecting Profile.
      // Keep the legacy full refresh only for canonical book/session changes or
      // an actual local import repair that must be reflected throughout the app.
      if (canonicalCollectionsChanged || repairedDelta !== 0 || historyChanged) {
        setRevision(getCloudDataRevision() + (repairedDelta !== 0 || historyChanged ? 1 : 0));
      }

      void synchronizeProfileMedia(user.uid).catch(() => {
        // Offline/background failures are expected. The durable media queue will
        // retry on the next foreground/online refresh without blocking the app.
      });
    };

    // Retry pending profile media immediately after account hydration as well as
    // on later resume/online events.
    void synchronizeProfileMedia(user.uid).catch(() => undefined);
    if (getCloudDataRevision() > 0) {
      // The first signed-in mount still needs to reveal the already-hydrated app.
      // Do not force an additional App remount merely because that hydration was
      // profile-only; the current storage snapshot will be read when children mount.
      setRevision(getCloudDataRevision());
    }
    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, refresh);
    const unsubscribeResume = subscribeToRuntimeResume(() => refresh());
    return () => {
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, refresh);
      unsubscribeResume();
    };
  }, [user?.uid]);

  if (user && revision === 0) {
    return <main className="grid min-h-[100dvh] place-items-center bg-[var(--ink-page)] px-6 text-center text-[var(--ink-ivory)]">Opening Inkbound...</main>;
  }

  return <React.Fragment key={`${user?.uid ?? 'signed-out'}:${revision}`}>{children}</React.Fragment>;
};
