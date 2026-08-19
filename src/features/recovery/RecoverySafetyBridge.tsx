import React, { useEffect, useRef } from 'react';
import { useAccountSync } from '../../context/AccountSyncContext';
import { INKBOUND_BEFORE_SIGN_OUT_EVENT, type BeforeSignOutDetail } from '../sync/cloudSyncEvents';
import { createRecoveryPoint } from './dataRecovery';

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

    const checkpoint = async (reason: string, force = false) => {
      if (disposed || checkpointRunning.current) return;
      checkpointRunning.current = true;
      try {
        await createRecoveryPoint(uid, reason, { force });
      } catch (error) {
        // Recovery is a safety net and must never prevent normal reading/sync.
        console.warn('Inkbound could not create a recovery point.', error);
      } finally {
        checkpointRunning.current = false;
      }
    };

    // Establish one safety baseline when a signed-in session starts. The snapshot
    // fingerprint prevents identical reloads from storing duplicate full copies.
    void checkpoint('Automatic daily safety copy');

    // A full library snapshot can contain hundreds or thousands of records, so
    // periodic protection is intentionally daily rather than minute-based. Risky
    // operations such as imports and restores create their own event-based copies.
    const interval = window.setInterval(() => {
      void checkpoint('Automatic daily safety copy');
    }, DAILY_RECOVERY_MS);

    const beforeSignOut = (event: Event) => {
      const detail = (event as CustomEvent<BeforeSignOutDetail>).detail;
      if (detail?.uid !== uid) return;
      detail.waitUntil(checkpoint('Before sign out'));
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