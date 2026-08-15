import React, { useEffect, useRef } from 'react';
import { useAccountSync } from '../../context/AccountSyncContext';
import { subscribeToRuntimeResume } from '../../platform/runtimeLifecycle';
import {
  flushPhotoMemorySyncQueue,
  synchronizePhotoMemories,
} from './photoMemoryCloudSync';
import { subscribeToPhotoMemorySyncQueue } from './photoMemorySyncQueue';

const SYNC_DEBOUNCE_MS = 600;
type SyncMode = 'flush' | 'full';

export const PhotoMemoryAutoSyncBridge: React.FC = () => {
  const { user } = useAccountSync();
  const syncingRef = useRef(false);
  const pendingModeRef = useRef<SyncMode | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!user) return undefined;

    let disposed = false;

    const mergePendingMode = (mode: SyncMode) => {
      pendingModeRef.current = pendingModeRef.current === 'full' || mode === 'full' ? 'full' : 'flush';
    };

    const runSync = async (mode: SyncMode) => {
      if (disposed) return;
      if (syncingRef.current) {
        mergePendingMode(mode);
        return;
      }
      syncingRef.current = true;
      try {
        if (mode === 'full') await synchronizePhotoMemories(user.uid);
        else await flushPhotoMemorySyncQueue(user.uid);
      } catch (error) {
        // Offline/temporary Firebase failures are expected on mobile. Pending
        // mutations remain durable and retry on the next queue/resume signal.
        console.info('Inkbound photo sync will retry later.', error);
      } finally {
        syncingRef.current = false;
        if (!disposed && pendingModeRef.current) {
          const nextMode = pendingModeRef.current;
          pendingModeRef.current = null;
          void runSync(nextMode);
        }
      }
    };

    const scheduleSync = (mode: SyncMode) => {
      mergePendingMode(mode);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const scheduledMode = pendingModeRef.current ?? mode;
        pendingModeRef.current = null;
        void runSync(scheduledMode);
      }, SYNC_DEBOUNCE_MS);
    };

    const unsubscribeQueue = subscribeToPhotoMemorySyncQueue(() => scheduleSync('flush'));
    const unsubscribeResume = subscribeToRuntimeResume(() => scheduleSync('full'));
    scheduleSync('full');

    return () => {
      disposed = true;
      unsubscribeQueue();
      unsubscribeResume();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingModeRef.current = null;
    };
  }, [user?.uid]);

  return null;
};
