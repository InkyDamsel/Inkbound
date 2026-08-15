import React, { useEffect, useRef } from 'react';
import { useAccountSync } from '../../context/AccountSyncContext';
import { subscribeToRuntimeResume } from '../../platform/runtimeLifecycle';
import { synchronizePhotoMemories } from './photoMemoryCloudSync';
import { subscribeToPhotoMemorySyncQueue } from './photoMemorySyncQueue';

const SYNC_DEBOUNCE_MS = 600;

export const PhotoMemoryAutoSyncBridge: React.FC = () => {
  const { user } = useAccountSync();
  const syncingRef = useRef(false);
  const rerunRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!user) return undefined;

    let disposed = false;

    const runSync = async () => {
      if (disposed) return;
      if (syncingRef.current) {
        rerunRef.current = true;
        return;
      }
      syncingRef.current = true;
      try {
        await synchronizePhotoMemories(user.uid);
      } catch (error) {
        // Offline/temporary Firebase failures are expected on mobile. Pending
        // operations remain durable and retry on the next queue/resume signal.
        console.info('Inkbound photo sync will retry later.', error);
      } finally {
        syncingRef.current = false;
        if (!disposed && rerunRef.current) {
          rerunRef.current = false;
          void runSync();
        }
      }
    };

    const scheduleSync = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void runSync();
      }, SYNC_DEBOUNCE_MS);
    };

    const unsubscribeQueue = subscribeToPhotoMemorySyncQueue(scheduleSync);
    const unsubscribeResume = subscribeToRuntimeResume(scheduleSync);
    scheduleSync();

    return () => {
      disposed = true;
      unsubscribeQueue();
      unsubscribeResume();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      rerunRef.current = false;
    };
  }, [user?.uid]);

  return null;
};
