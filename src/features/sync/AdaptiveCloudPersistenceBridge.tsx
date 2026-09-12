import React, { useEffect, useRef, useState } from 'react';
import {
  INKBOUND_CLOUD_DATA_EVENT,
  type CloudDataUpdatedDetail,
} from './cloudSyncEvents';
import { CloudPersistenceBridge } from './CloudPersistenceBridge';
import { CostSafeCloudPersistenceBridge } from './CostSafeCloudPersistenceBridge';

const BOOKS_KEY = 'inkbound_books';
const RECONCILE_COOLDOWN_MS = 30_000;
const RECONCILE_SETTLE_MS = 8_000;

/**
 * Cross-device sync has two jobs that must not be confused:
 *
 * 1. Reconcile this device with the account copy so changes made on another
 *    device are seen before the local cache is treated as current.
 * 2. Stay local-first after reconciliation so a large library does not keep
 *    paying for continuous Firestore collection listeners.
 *
 * Run the canonical reconciliation bridge once per open, then fall back to the
 * cost-safe local-first bridge. Returning to Inkbound after enough time (or
 * reconnecting) runs another bounded reconciliation pass so web and Android do
 * not drift indefinitely.
 *
 * The settle window intentionally remains long enough for the initial Firestore
 * snapshot and durable pending queue to resolve on slower connections and larger
 * libraries. Switching to the cost-safe bridge too quickly can unmount the
 * listener before a newer record from another device is accepted.
 */
export const AdaptiveCloudPersistenceBridge: React.FC = () => {
  const [isReconciling, setIsReconciling] = useState(true);
  const lastReconcileAt = useRef(0);
  const settleTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const finishReconcileAfterSettle = (event: Event) => {
      if (!isReconciling) return;
      const detail = (event as CustomEvent<CloudDataUpdatedDetail>).detail;
      if (detail?.keys && !detail.keys.includes(BOOKS_KEY)) return;

      if (settleTimer.current !== undefined) window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => {
        settleTimer.current = undefined;
        lastReconcileAt.current = Date.now();
        setIsReconciling(false);
      }, RECONCILE_SETTLE_MS);
    };

    const requestReconcile = () => {
      if (isReconciling) return;
      if (Date.now() - lastReconcileAt.current < RECONCILE_COOLDOWN_MS) return;
      setIsReconciling(true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') requestReconcile();
    };

    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, finishReconcileAfterSettle);
    window.addEventListener('online', requestReconcile);
    window.addEventListener('focus', requestReconcile);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, finishReconcileAfterSettle);
      window.removeEventListener('online', requestReconcile);
      window.removeEventListener('focus', requestReconcile);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (settleTimer.current !== undefined) {
        window.clearTimeout(settleTimer.current);
        settleTimer.current = undefined;
      }
    };
  }, [isReconciling]);

  return isReconciling
    ? <CloudPersistenceBridge />
    : <CostSafeCloudPersistenceBridge />;
};
