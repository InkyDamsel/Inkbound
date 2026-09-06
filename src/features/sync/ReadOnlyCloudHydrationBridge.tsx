import React, { useEffect } from 'react';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db, readDb } from '../../lib/firebase';
import { readRuntimeValue, writeRuntimeValue } from '../../platform/runtimeStorage';
import { notifyCloudDataUpdated } from './cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from './storageKeys';

const BOOKS_KEY = SYNC_STORAGE_KEYS.books;
const SESSIONS_KEY = SYNC_STORAGE_KEYS.sessions;
const PROFILE_KEY = SYNC_STORAGE_KEYS.profile;
const OWNER_UID_KEY = SYNC_STORAGE_KEYS.localOwnerUid;

/**
 * Protected development mode is intentionally LOCAL ONLY.
 *
 * When Inkbound is running from the development server without explicit
 * production-write mode, Firebase Auth may still point at the real project so a
 * developer can sign in, but the app must not silently read production Firestore
 * collections. A large-library stress test can turn a harmless localhost reload
 * into tens of thousands of billable reads if this bridge hydrates or subscribes
 * to the real books collection.
 *
 * Intentional live-cloud beta verification remains available by starting the app
 * with VITE_FIREBASE_MODE=production. In that mode `db` is available and the
 * normal AdaptiveCloudPersistenceBridge owns one-time hydration plus local-first
 * persistence.
 */
export const ReadOnlyCloudHydrationBridge: React.FC = () => {
  const sync = useAccountSync();

  useEffect(() => {
    if (!sync.user || !readDb || db) return undefined;

    const uid = sync.user.uid;
    const previousOwnerUid = readRuntimeValue(OWNER_UID_KEY);

    if (!previousOwnerUid || previousOwnerUid === uid) {
      writeRuntimeValue(OWNER_UID_KEY, uid);
    }

    notifyCloudDataUpdated([BOOKS_KEY, SESSIONS_KEY, PROFILE_KEY]);

    console.info(
      'Inkbound DEV protected mode: using the local working copy only. Production Firestore reads are disabled to prevent test billing. Set VITE_FIREBASE_MODE=production only for intentional live-cloud beta verification.',
    );

    return undefined;
  }, [sync.user?.uid]);

  return null;
};
