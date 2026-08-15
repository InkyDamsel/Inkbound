import React, { useEffect, useRef } from 'react';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import {
  getRuntimeStorage,
  notifyRuntimeStorageChanged,
} from '../../platform/runtimeStorage';
import {
  AUXILIARY_ACCOUNT_KEYS,
  type AuxiliaryAccountKeyName,
  getAuxiliaryBaselineKey,
  getAuxiliaryPendingKey,
} from './auxiliaryAccountSyncConfig';
import {
  INKBOUND_BEFORE_SIGN_OUT_EVENT,
  type BeforeSignOutDetail,
} from './cloudSyncEvents';

interface CloudAuxiliaryRecord {
  data: unknown;
  clientUpdatedAt?: string;
}

interface PendingAuxiliaryMutation {
  data: unknown;
  clientUpdatedAt: string;
}

type PendingState = Partial<Record<AuxiliaryAccountKeyName, PendingAuxiliaryMutation>>;
type BaselineState = Partial<Record<AuxiliaryAccountKeyName, string>>;

const POLL_MS = 1500;
const OWNER_UID_KEY = 'inkbound_local_data_owner_uid';
const storage = () => getRuntimeStorage();
const stable = (value: unknown) => JSON.stringify(value);

function safeParse<T>(key: string, fallback: T): T {
  try {
    const value = storage().getItem(key);
    return value === null ? fallback : JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function readLocalValue(key: string): unknown {
  try {
    const value = storage().getItem(key);
    return value === null ? undefined : JSON.parse(value);
  } catch {
    return undefined;
  }
}

function writeLocalValue(key: string, value: unknown, notify = false) {
  storage().setItem(key, stable(value));
  if (notify) notifyRuntimeStorageChanged(key);
}

function readPending(uid: string): PendingState {
  return safeParse<PendingState>(getAuxiliaryPendingKey(uid), {});
}

function writePending(uid: string, pending: PendingState) {
  if (Object.keys(pending).length === 0) storage().removeItem(getAuxiliaryPendingKey(uid));
  else storage().setItem(getAuxiliaryPendingKey(uid), stable(pending));
}

function readBaseline(uid: string): BaselineState {
  return safeParse<BaselineState>(getAuxiliaryBaselineKey(uid), {});
}

function writeBaseline(uid: string, baseline: BaselineState) {
  storage().setItem(getAuxiliaryBaselineKey(uid), stable(baseline));
}

function isMeaningful(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

export const AuxiliaryAccountSyncBridge: React.FC = () => {
  const sync = useAccountSync();
  const hydrated = useRef(false);
  const fingerprints = useRef<Partial<Record<AuxiliaryAccountKeyName, string>>>({});
  const pollRunning = useRef(false);

  useEffect(() => {
    hydrated.current = false;
    fingerprints.current = {};
    pollRunning.current = false;

    if (!sync.user || !db) return undefined;
    const uid = sync.user.uid;
    let disposed = false;

    const captureLocalChanges = () => {
      if (!hydrated.current || disposed) return;
      const pending = readPending(uid);
      const now = new Date().toISOString();

      (Object.entries(AUXILIARY_ACCOUNT_KEYS) as Array<[AuxiliaryAccountKeyName, string]>).forEach(([name, key]) => {
        const value = readLocalValue(key);
        if (value === undefined) return;
        const fingerprint = stable(value);
        if (fingerprints.current[name] === fingerprint) return;
        pending[name] = { data: value, clientUpdatedAt: now };
        fingerprints.current[name] = fingerprint;
      });

      writePending(uid, pending);
    };

    const flushPending = async () => {
      const pending = readPending(uid);
      const entries = Object.entries(pending) as Array<[AuxiliaryAccountKeyName, PendingAuxiliaryMutation]>;
      if (entries.length === 0) return;

      const baseline = readBaseline(uid);
      await Promise.all(entries.map(async ([name, mutation]) => {
        await setDoc(
          doc(db!, 'users', uid, 'auxiliary', name),
          {
            data: mutation.data,
            updatedAt: serverTimestamp(),
            clientUpdatedAt: mutation.clientUpdatedAt,
          },
          { merge: true },
        );
      }));

      const latestPending = readPending(uid);
      entries.forEach(([name, mutation]) => {
        if (stable(latestPending[name]) !== stable(mutation)) return;
        const fingerprint = stable(mutation.data);
        baseline[name] = fingerprint;
        fingerprints.current[name] = fingerprint;
        delete latestPending[name];
      });
      writeBaseline(uid, baseline);
      writePending(uid, latestPending);
    };

    const initialize = async () => {
      const previousOwnerUid = storage().getItem(OWNER_UID_KEY);
      const sameAccountLocalData = !previousOwnerUid || previousOwnerUid === uid;
      const baseline = readBaseline(uid);
      const pending = readPending(uid);
      const now = new Date().toISOString();

      if (sameAccountLocalData) {
        (Object.entries(AUXILIARY_ACCOUNT_KEYS) as Array<[AuxiliaryAccountKeyName, string]>).forEach(([name, key]) => {
          const localValue = readLocalValue(key);
          if (localValue === undefined) return;
          const fingerprint = stable(localValue);
          if (baseline[name] !== undefined && baseline[name] !== fingerprint && !pending[name]) {
            pending[name] = { data: localValue, clientUpdatedAt: now };
          }
        });
      }

      let cloudDocs: Awaited<ReturnType<typeof getDocs>> | undefined;
      try {
        cloudDocs = await getDocs(collection(db!, 'users', uid, 'auxiliary'));
      } catch {
        // Offline startup remains usable. Pending local mutations stay durable and
        // will retry through the normal poll/foreground lifecycle.
      }
      if (disposed) return;

      const cloudByName = new Map<AuxiliaryAccountKeyName, CloudAuxiliaryRecord>();
      cloudDocs?.docs.forEach((item) => {
        if (!(item.id in AUXILIARY_ACCOUNT_KEYS)) return;
        cloudByName.set(item.id as AuxiliaryAccountKeyName, item.data() as CloudAuxiliaryRecord);
      });

      const nextBaseline: BaselineState = { ...baseline };
      (Object.entries(AUXILIARY_ACCOUNT_KEYS) as Array<[AuxiliaryAccountKeyName, string]>).forEach(([name, key]) => {
        const cloudRecord = cloudByName.get(name);
        const localValue = sameAccountLocalData ? readLocalValue(key) : undefined;
        const localPending = pending[name];

        if (cloudRecord) nextBaseline[name] = stable(cloudRecord.data);

        if (localPending) {
          writeLocalValue(key, localPending.data);
          fingerprints.current[name] = stable(localPending.data);
          return;
        }

        if (cloudRecord) {
          writeLocalValue(key, cloudRecord.data, true);
          fingerprints.current[name] = stable(cloudRecord.data);
          return;
        }

        if (sameAccountLocalData && isMeaningful(localValue)) {
          pending[name] = { data: localValue, clientUpdatedAt: now };
          fingerprints.current[name] = stable(localValue);
          return;
        }

        fingerprints.current[name] = localValue === undefined ? undefined : stable(localValue);
      });

      writeBaseline(uid, nextBaseline);
      writePending(uid, pending);
      hydrated.current = true;

      try {
        await flushPending();
      } catch {
        // Keep pending data queued for a later online retry.
      }
    };

    void initialize().catch(() => {
      if (disposed) return;
      hydrated.current = true;
      (Object.entries(AUXILIARY_ACCOUNT_KEYS) as Array<[AuxiliaryAccountKeyName, string]>).forEach(([name, key]) => {
        const value = readLocalValue(key);
        fingerprints.current[name] = value === undefined ? undefined : stable(value);
      });
    });

    const unsubscribe = onSnapshot(
      collection(db, 'users', uid, 'auxiliary'),
      (snapshot) => {
        if (!hydrated.current) return;
        const pending = readPending(uid);
        const baseline = readBaseline(uid);
        let baselineChanged = false;

        snapshot.docChanges().forEach((change) => {
          if (change.type === 'removed' || !(change.doc.id in AUXILIARY_ACCOUNT_KEYS)) return;
          const name = change.doc.id as AuxiliaryAccountKeyName;
          if (pending[name]) return;
          const record = change.doc.data() as CloudAuxiliaryRecord;
          const key = AUXILIARY_ACCOUNT_KEYS[name];
          const fingerprint = stable(record.data);
          if (baseline[name] !== fingerprint) {
            baseline[name] = fingerprint;
            baselineChanged = true;
          }
          if (fingerprints.current[name] === fingerprint) return;
          writeLocalValue(key, record.data, true);
          fingerprints.current[name] = fingerprint;
        });

        if (baselineChanged) writeBaseline(uid, baseline);
      },
      () => {
        // The local cache remains authoritative while offline; the next poll or
        // app resume will retry queued changes.
      },
    );

    const poll = window.setInterval(async () => {
      if (!hydrated.current || disposed || pollRunning.current) return;
      pollRunning.current = true;
      try {
        captureLocalChanges();
        await flushPending();
      } catch {
        // Expected while offline; pending state remains durable.
      } finally {
        pollRunning.current = false;
      }
    }, POLL_MS);

    const preserveBeforeBackgrounding = () => captureLocalChanges();
    const flushBeforeSignOut = (event: Event) => {
      const detail = (event as CustomEvent<BeforeSignOutDetail>).detail;
      if (detail?.uid !== uid) return;
      captureLocalChanges();
      detail.waitUntil(flushPending());
    };

    window.addEventListener('pagehide', preserveBeforeBackgrounding);
    document.addEventListener('visibilitychange', preserveBeforeBackgrounding);
    window.addEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, flushBeforeSignOut);

    return () => {
      preserveBeforeBackgrounding();
      disposed = true;
      window.clearInterval(poll);
      window.removeEventListener('pagehide', preserveBeforeBackgrounding);
      document.removeEventListener('visibilitychange', preserveBeforeBackgrounding);
      window.removeEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, flushBeforeSignOut);
      unsubscribe();
    };
  }, [sync.user?.uid]);

  return null;
};
