import React, { useEffect } from 'react';
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import type { ReadingSession } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import {
  syncBaselineStateKey,
  SYNC_STORAGE_KEYS,
} from './storageKeys';

interface SyncBaseline {
  books: Record<string, string>;
  sessions: Record<string, string>;
  profile?: string;
}

interface TombstoneRecord {
  kind?: 'books' | 'sessions';
  recordId?: string;
}

const REPAIR_VERSION = '1';
const repairKey = (uid: string) => `inkbound_session_evidence_repair_${uid}_v${REPAIR_VERSION}`;
const stable = (value: unknown) => JSON.stringify(value);
const hashText = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};
const fingerprint = (value: unknown) => hashText(stable(value));

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = getRuntimeStorage().getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

/**
 * One-time repair for sessions that already existed locally before the current
 * trusted-mutation pipeline was installed.
 *
 * Safety rules:
 * - read only the small sessions/tombstones datasets; never scan the full library;
 * - upload only local session IDs that are absent from cloud AND absent from the
 *   sync baseline (meaning this device has never confirmed them in cloud);
 * - never resurrect a session that has a cloud tombstone;
 * - mark the repair complete only after every eligible local-only session has
 *   been written successfully.
 */
export const SessionEvidenceRecoveryBridge: React.FC = () => {
  const { user } = useAccountSync();

  useEffect(() => {
    if (!user || !db || !navigator.onLine) return undefined;
    const uid = user.uid;
    const storage = getRuntimeStorage();
    if (storage.getItem(repairKey(uid)) === REPAIR_VERSION) return undefined;

    let disposed = false;

    const repair = async () => {
      try {
        const localSessions = readJson<ReadingSession[]>(SYNC_STORAGE_KEYS.sessions, []);
        if (disposed) return;

        const [cloudSessionsSnapshot, sessionTombstonesSnapshot] = await Promise.all([
          getDocs(collection(db!, 'users', uid, 'sessions')),
          getDocs(query(
            collection(db!, 'users', uid, 'syncTombstones'),
            where('kind', '==', 'sessions'),
          )),
        ]);
        if (disposed) return;

        const cloudIds = new Set(cloudSessionsSnapshot.docs.map((item) => item.id));
        const tombstonedIds = new Set(
          sessionTombstonesSnapshot.docs
            .map((item) => (item.data() as TombstoneRecord).recordId?.trim())
            .filter((id): id is string => Boolean(id)),
        );
        const baseline = readJson<SyncBaseline>(
          syncBaselineStateKey(uid),
          { books: {}, sessions: {} },
        );

        const recoverable = localSessions.filter((session) => (
          session?.id
          && !cloudIds.has(session.id)
          && !tombstonedIds.has(session.id)
          && baseline.sessions[session.id] === undefined
        ));

        if (recoverable.length > 0) {
          const clientUpdatedAt = new Date().toISOString();
          const results = await Promise.allSettled(recoverable.map((session) => setDoc(
            doc(db!, 'users', uid, 'sessions', session.id),
            {
              data: session,
              updatedAt: serverTimestamp(),
              clientUpdatedAt,
            },
            { merge: true },
          )));
          const failed = results.filter((result) => result.status === 'rejected');
          if (failed.length > 0) {
            throw new Error(`Could not recover ${failed.length} local session(s).`);
          }

          recoverable.forEach((session) => {
            baseline.sessions[session.id] = fingerprint(session);
          });
          storage.setItem(syncBaselineStateKey(uid), stable(baseline));
        }

        storage.setItem(repairKey(uid), REPAIR_VERSION);
        console.info('[Inkbound sync] Existing local session evidence repair complete.', {
          localSessions: localSessions.length,
          cloudSessions: cloudIds.size,
          tombstonedSessions: tombstonedIds.size,
          recoveredSessions: recoverable.length,
        });
      } catch (error) {
        console.warn('[Inkbound sync] Existing local session evidence repair will retry later.', error);
      }
    };

    void repair();
    const onOnline = () => { void repair(); };
    window.addEventListener('online', onOnline);
    return () => {
      disposed = true;
      window.removeEventListener('online', onOnline);
    };
  }, [user?.uid]);

  return null;
};
