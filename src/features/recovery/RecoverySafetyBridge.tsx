import React, { useEffect, useRef } from 'react';
import { useAccountSync } from '../../context/AccountSyncContext';
import { INKBOUND_BEFORE_SIGN_OUT_EVENT, type BeforeSignOutDetail } from '../sync/cloudSyncEvents';
import { createRecoveryPoint, listRecoveryPoints } from './dataRecovery';

const DAILY_RECOVERY_MS = 24 * 60 * 60 * 1000;

/**
 * Creates durable, account-owned recovery points independently of the normal
 * sync baseline. A recovery point is a versioned safety copy, never a second
 * source of truth: books/sessions/profile/auxiliary Firestore records remain the
 * live canonical data.
 */
export const RecoverySafetyBridge: React.FC = () => {
  const { user } = useAccountSync();
  const checkpointRunning = useRef(false);

  useEffect(() => {
    if (!user) return undefined;
    const uid = user.uid;
    let disposed = false;

    const checkpoint = async (reason: string) => {
      if (disposed || checkpointRunning.current) return;
      checkpointRunning.current = true;
      try {
        const latest = (await listRecoveryPoints(uid))[0];
        const latestMillis = latest?.createdAtClient ? new Date(latest.createdAtClient).getTime() : 0;
        const hasRecentRecovery = Number.isFinite(latestMillis) && latestMillis > 0 && Date.now() - latestMillis < DAILY_RECOVERY_MS;
        if (!hasRecentRecovery) await createRecoveryPoint(uid, reason);
      } catch (error) {
        // Recovery is a safety net and must never prevent normal reading/sync.
        console.warn('Inkbound could not create a recovery point.', error);
      } finally {
        checkpointRunning.current = false;
      }
    };

    // Establish at most one automatic safety baseline per 24-hour period.
    void checkpoint('Automatic daily safety copy');

    const interval = window.setInterval(() => {
      void checkpoint('Automatic daily safety copy');
    }, DAILY_RECOVERY_MS);

    const beforeSignOut = (event: Event) => {
      const detail = (event as CustomEvent<BeforeSignOutDetail>).detail;
      if (detail?.uid !== uid) return;
      detail.waitUntil(checkpoint('Automatic daily safety copy'));
    };

    window.addEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, beforeSignOut);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, beforeSignOut);
    };
  }, [user?.uid]);

  return null;
};