import React, { useEffect, useRef } from 'react';
import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import type { ReadingSession, UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db, storage } from '../../lib/firebase';
import { subscribeToRuntimeResume } from '../../platform/runtimeLifecycle';
import { applyRuntimeJsonFromExternalSource, applyRuntimeValueFromExternalSource, getRuntimeStorage } from '../../platform/runtimeStorage';
import {
  INKBOUND_BEFORE_SIGN_OUT_EVENT,
  INKBOUND_CLOUD_DATA_EVENT,
  INKBOUND_CORE_RECONCILED_EVENT,
  INKBOUND_LOCAL_DATA_CHANGED_EVENT,
  type BeforeSignOutDetail,
  type CloudDataUpdatedDetail,
  type CloudSyncedStorageKey,
  type CoreCloudReconciledDetail,
  type LocalDataChangedDetail,
} from './cloudSyncEvents';
import { deleteCoreCloudRecord, upsertCoreCloudRecord } from './coreCloudRecords';
import { fingerprintSyncValue, stableSyncValue } from './syncFingerprint';
import {
  SYNC_STORAGE_KEYS,
  localClearIntentKey,
  syncBaselineStateKey,
  syncPendingStateKey,
} from './storageKeys';

const BOOKS_KEY: CloudSyncedStorageKey = SYNC_STORAGE_KEYS.books;
const SESSIONS_KEY: CloudSyncedStorageKey = SYNC_STORAGE_KEYS.sessions;
const PROFILE_KEY: CloudSyncedStorageKey = SYNC_STORAGE_KEYS.profile;
const OWNER_UID_KEY = SYNC_STORAGE_KEYS.localOwnerUid;
const SYNC_FLUSH_DEBOUNCE_MS = 3000;
const UPLOAD_BATCH_SIZE = 50;
// Cost fuse: automatic background sync may only publish this many record
// mutations per pass. Remaining mutations stay durably queued and retry later.
// A large import can take a few minutes to finish syncing, but a bug can no
// longer generate an unbounded Firestore write storm.
const MAX_RECORD_WRITES_PER_FLUSH = 50;
const SYNC_RETRY_DELAYS_MS = [30000, 60000, 120000] as const;

interface ReaderProfile {
  displayName?: string;
  email?: string;
  favoriteQuote?: string;
  bio?: string;
  avatarImage?: string;
  bannerImage?: string;
}

type MutationOperation = 'upsert' | 'delete';
type RecordKind = 'books' | 'sessions';
interface RecordMutation<T> { operation: MutationOperation; data?: T; clientUpdatedAt: string }
interface ProfileMutation { data: ReaderProfile; clientUpdatedAt: string }
interface PendingSyncState {
  books: Record<string, RecordMutation<UserBookRecord>>;
  sessions: Record<string, RecordMutation<ReadingSession>>;
  profile?: ProfileMutation;
}
interface SyncBaseline { books: Record<string, string>; sessions: Record<string, string>; profile?: string }

const runtimeStorage = () => getRuntimeStorage();
const stable = stableSyncValue;
const fingerprint = fingerprintSyncValue;
const emptyPending = (): PendingSyncState => ({ books: {}, sessions: {} });
const emptyBaseline = (): SyncBaseline => ({ books: {}, sessions: {} });

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = runtimeStorage().getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

const readPending = (uid: string) => readJson<PendingSyncState>(syncPendingStateKey(uid), emptyPending());
const readBaseline = (uid: string) => readJson<SyncBaseline>(syncBaselineStateKey(uid), emptyBaseline());
const writeBaseline = (uid: string, value: SyncBaseline) => runtimeStorage().setItem(syncBaselineStateKey(uid), stable(value));
const writePending = (uid: string, value: PendingSyncState) => {
  const key = syncPendingStateKey(uid);
  if (!Object.keys(value.books).length && !Object.keys(value.sessions).length && !value.profile) {
    runtimeStorage().removeItem(key);
  } else {
    runtimeStorage().setItem(key, stable(value));
  }
};

const toFingerprintMap = <T extends { id: string }>(items: T[]) =>
  new Map(items.map((item) => [item.id, fingerprint(item)]));

function captureWorkingChanges<T extends { id: string }>(
  items: T[],
  fingerprints: React.MutableRefObject<Map<string, string>>,
  mutations: Record<string, RecordMutation<T>>,
  baseline: Record<string, string>,
) {
  const next = new Map<string, string>();
  const now = new Date().toISOString();

  items.forEach((item) => {
    const itemFingerprint = fingerprint(item);
    next.set(item.id, itemFingerprint);
    if (fingerprints.current.get(item.id) !== itemFingerprint) {
      if (baseline[item.id] === itemFingerprint) delete mutations[item.id];
      else mutations[item.id] = { operation: 'upsert', data: item, clientUpdatedAt: now };
    }
  });

  fingerprints.current.forEach((_value, id) => {
    if (next.has(id)) return;
    if (baseline[id] === undefined) delete mutations[id];
    else mutations[id] = { operation: 'delete', clientUpdatedAt: now };
  });
  fingerprints.current = next;
}

function removeNoOpMutations<T>(mutations: Record<string, RecordMutation<T>>, baseline: Record<string, string>) {
  Object.entries(mutations).forEach(([id, mutation]) => {
    if (mutation.operation === 'delete') {
      if (baseline[id] === undefined) delete mutations[id];
      return;
    }
    if (mutation.data !== undefined && baseline[id] === fingerprint(mutation.data)) delete mutations[id];
  });
}

const isDataImage = (value?: string) => Boolean(value?.startsWith('data:image/'));

async function optimizeProfileImage(value: string, kind: 'avatar' | 'banner'): Promise<Blob> {
  const source = await fetch(value).then((response) => response.blob());
  const bitmap = await createImageBitmap(source);
  const maximumWidth = kind === 'avatar' ? 512 : 1600;
  const maximumHeight = kind === 'avatar' ? 512 : 700;
  const scale = Math.min(1, maximumWidth / bitmap.width, maximumHeight / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) { bitmap.close(); return source; }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise<Blob>((resolve) => canvas.toBlob(
    (blob) => resolve(blob ?? source), 'image/webp', kind === 'avatar' ? 0.84 : 0.8,
  ));
}

async function uploadProfileImage(uid: string, kind: 'avatar' | 'banner', value?: string) {
  if (!value || !isDataImage(value) || !storage) return value;
  const blob = await optimizeProfileImage(value, kind);
  const imageRef = ref(storage, `users/${uid}/profile/${kind}-${fingerprintSyncValue(value)}.webp`);
  await uploadBytes(imageRef, blob, { contentType: 'image/webp', cacheControl: 'public,max-age=31536000,immutable' });
  return getDownloadURL(imageRef);
}

async function prepareCloudProfile(uid: string, profile: ReaderProfile): Promise<ReaderProfile> {
  const [avatarImage, bannerImage] = await Promise.all([
    uploadProfileImage(uid, 'avatar', profile.avatarImage),
    uploadProfileImage(uid, 'banner', profile.bannerImage),
  ]);
  return { ...profile, avatarImage, bannerImage };
}

/**
 * Local-first persistence for an already-hydrated device.
 *
 * This bridge deliberately performs no Firestore collection reads and creates no
 * collection listeners. The local library is the working copy; changed records
 * are uploaded from the durable pending queue. A full server comparison is only
 * done by CloudServerRefreshBridge when the reader explicitly asks for one.
 *
 * Existing pending writes are deliberately held until CrossDeviceDeltaSyncBridge
 * completes a successful cloud reconciliation for this foreground/open cycle.
 * That ordering prevents a stale device from publishing old page/session state
 * before it has first seen newer progress recorded on another device.
 *
 * Retry-on-foreground is driven by runtimeLifecycle so browser visibility and
 * Android Capacitor appStateChange use the exact same persistence path. Partial
 * failures also retry with a bounded backoff while the app remains open so one
 * transient Firestore failure cannot strand the rest of a large import forever.
 */
export const CostSafeCloudPersistenceBridge: React.FC = () => {
  const sync = useAccountSync();
  const bookFingerprints = useRef(new Map<string, string>());
  const sessionFingerprints = useRef(new Map<string, string>());
  const profileFingerprint = useRef('');

  useEffect(() => {
    if (!sync.user || !db) return undefined;

    const uid = sync.user.uid;
    let disposed = false;
    let coreReconciled = false;
    let flushTimer: number | undefined;
    let retryTimer: number | undefined;
    let retryAttempt = 0;
    let flushInFlight: Promise<void> | undefined;
    let flushRequested = false;

    const resetWorkingFingerprints = (keys?: CloudSyncedStorageKey[]) => {
      const changedKeys = keys ? new Set(keys) : undefined;
      if (!changedKeys || changedKeys.has(BOOKS_KEY)) {
        bookFingerprints.current = toFingerprintMap(readJson<UserBookRecord[]>(BOOKS_KEY, []));
      }
      if (!changedKeys || changedKeys.has(SESSIONS_KEY)) {
        sessionFingerprints.current = toFingerprintMap(readJson<ReadingSession[]>(SESSIONS_KEY, []));
      }
      if (!changedKeys || changedKeys.has(PROFILE_KEY)) {
        profileFingerprint.current = stable(readJson<ReaderProfile>(PROFILE_KEY, {}));
      }
    };

    resetWorkingFingerprints();
    applyRuntimeValueFromExternalSource(OWNER_UID_KEY, uid);

    const checkpointRecordBatch = <T,>(
      kind: RecordKind,
      entries: Array<[string, RecordMutation<T>]>,
    ) => {
      const latestPending = readPending(uid);
      const latestBaseline = readBaseline(uid);
      const pendingCollection = kind === 'books' ? latestPending.books : latestPending.sessions;
      const baselineCollection = kind === 'books' ? latestBaseline.books : latestBaseline.sessions;

      entries.forEach(([id, mutation]) => {
        if (stable(pendingCollection[id]) !== stable(mutation)) return;
        if (mutation.operation === 'delete') delete baselineCollection[id];
        else if (mutation.data !== undefined) baselineCollection[id] = fingerprint(mutation.data);
        delete pendingCollection[id];
      });

      writeBaseline(uid, latestBaseline);
      writePending(uid, latestPending);
    };

    const uploadRecordEntries = async <T extends { id: string },>(
      kind: RecordKind,
      entries: Array<[string, RecordMutation<T>]>,
    ): Promise<number> => {
      let failedWrites = 0;
      for (let index = 0; index < entries.length; index += UPLOAD_BATCH_SIZE) {
        if (disposed) return failedWrites;
        const batch = entries.slice(index, index + UPLOAD_BATCH_SIZE);
        const results = await Promise.allSettled(batch.map(async ([id, mutation]) => {
          if (mutation.operation === 'delete') {
            await deleteCoreCloudRecord(uid, kind, id, mutation.clientUpdatedAt);
          } else if (mutation.data && 'id' in mutation.data) {
            await upsertCoreCloudRecord(uid, kind, mutation.data as T & { id: string }, mutation.clientUpdatedAt);
          }
        }));

        const successfulEntries: Array<[string, RecordMutation<T>]> = [];
        results.forEach((result, resultIndex) => {
          if (result.status === 'fulfilled') {
            successfulEntries.push(batch[resultIndex]);
          } else {
            failedWrites += 1;
            console.warn(`Inkbound cloud sync will retry a failed ${kind} write.`, result.reason);
          }
        });

        if (successfulEntries.length > 0) checkpointRecordBatch(kind, successfulEntries);
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      return failedWrites;
    };

    const performFlushPending = async (): Promise<boolean> => {
      if (!navigator.onLine || disposed || !coreReconciled) return false;
      const pending = readPending(uid);
      const baseline = readBaseline(uid);
      removeNoOpMutations(pending.books, baseline.books);
      removeNoOpMutations(pending.sessions, baseline.sessions);
      if (pending.profile && baseline.profile === stable(pending.profile.data)) delete pending.profile;
      writePending(uid, pending);

      const pendingBookEntries = Object.entries(pending.books);
      const pendingSessionEntries = Object.entries(pending.sessions);
      const bookEntries = pendingBookEntries.slice(0, MAX_RECORD_WRITES_PER_FLUSH);
      const remainingCapacity = Math.max(0, MAX_RECORD_WRITES_PER_FLUSH - bookEntries.length);
      const sessionEntries = pendingSessionEntries.slice(0, remainingCapacity);

      const failedBookWrites = await uploadRecordEntries<UserBookRecord>('books', bookEntries);
      const failedSessionWrites = await uploadRecordEntries<ReadingSession>('sessions', sessionEntries);

      const latestBeforeProfile = readPending(uid);
      if (pending.profile && stable(latestBeforeProfile.profile) === stable(pending.profile)) {
        try {
          const preparedProfile = await prepareCloudProfile(uid, pending.profile.data);
          await setDoc(doc(db!, 'users', uid, 'profile', 'current'), {
            data: preparedProfile,
            updatedAt: serverTimestamp(),
            clientUpdatedAt: pending.profile.clientUpdatedAt,
          }, { merge: true });

          const latestPending = readPending(uid);
          if (stable(latestPending.profile) === stable(pending.profile)) {
            const latestBaseline = readBaseline(uid);
            const preparedValue = stable(preparedProfile);
            latestBaseline.profile = preparedValue;
            delete latestPending.profile;
            writeBaseline(uid, latestBaseline);
            writePending(uid, latestPending);
            applyRuntimeJsonFromExternalSource(PROFILE_KEY, preparedProfile);
            profileFingerprint.current = preparedValue;
          }
        } catch (error) {
          console.warn('Inkbound cloud sync will retry the reader profile update.', error);
        }
      }

      const remaining = readPending(uid);
      return failedBookWrites > 0
        || failedSessionWrites > 0
        || Object.keys(remaining.books).length > 0
        || Object.keys(remaining.sessions).length > 0
        || Boolean(remaining.profile);
    };

    const clearRetryTimer = () => {
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    };

    let flushPending: () => Promise<void>;
    const scheduleRetry = () => {
      if (disposed || !navigator.onLine || retryTimer !== undefined || !coreReconciled) return;
      const retryIndex = Math.min(retryAttempt, SYNC_RETRY_DELAYS_MS.length - 1);
      const delay = SYNC_RETRY_DELAYS_MS[retryIndex];
      retryAttempt += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        void flushPending();
      }, delay);
    };

    flushPending = (): Promise<void> => {
      if (!coreReconciled) return Promise.resolve();
      flushRequested = true;
      if (flushInFlight) return flushInFlight;
      flushInFlight = (async () => {
        let retryNeeded = false;
        while (flushRequested && !disposed && coreReconciled) {
          flushRequested = false;
          try {
            retryNeeded = (await performFlushPending()) || retryNeeded;
          } catch (error) {
            retryNeeded = true;
            console.warn('Inkbound cloud sync paused after an unexpected error and will retry safely.', error);
          }
        }

        if (retryNeeded && !disposed && coreReconciled) {
          scheduleRetry();
        } else {
          retryAttempt = 0;
          clearRetryTimer();
        }
      })().finally(() => { flushInFlight = undefined; });
      return flushInFlight;
    };

    const captureCurrentChanges = (keys?: CloudSyncedStorageKey[]) => {
      if (disposed || runtimeStorage().getItem(localClearIntentKey(uid)) === '1') return;
      const changedKeys = keys ? new Set(keys) : undefined;
      const pending = readPending(uid);
      const baseline = readBaseline(uid);

      if (!changedKeys || changedKeys.has(BOOKS_KEY)) {
        captureWorkingChanges(readJson<UserBookRecord[]>(BOOKS_KEY, []), bookFingerprints, pending.books, baseline.books);
        removeNoOpMutations(pending.books, baseline.books);
      }
      if (!changedKeys || changedKeys.has(SESSIONS_KEY)) {
        captureWorkingChanges(readJson<ReadingSession[]>(SESSIONS_KEY, []), sessionFingerprints, pending.sessions, baseline.sessions);
        removeNoOpMutations(pending.sessions, baseline.sessions);
      }
      if (!changedKeys || changedKeys.has(PROFILE_KEY)) {
        const profile = readJson<ReaderProfile>(PROFILE_KEY, {});
        const profileValue = stable(profile);
        if (Object.keys(profile).length && profileValue !== profileFingerprint.current) {
          if (baseline.profile === profileValue) delete pending.profile;
          else pending.profile = { data: profile, clientUpdatedAt: new Date().toISOString() };
          profileFingerprint.current = profileValue;
        }
      }
      writePending(uid, pending);
    };

    const scheduleFlush = () => {
      if (!coreReconciled) return;
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(() => {
        flushTimer = undefined;
        void flushPending();
      }, SYNC_FLUSH_DEBOUNCE_MS);
    };

    const handleLocalChange = (event: Event) => {
      const detail = (event as CustomEvent<LocalDataChangedDetail>).detail;
      captureCurrentChanges(detail?.keys);
      clearRetryTimer();
      scheduleFlush();
    };

    const handleCloudUpdate = (event: Event) => {
      const detail = (event as CustomEvent<CloudDataUpdatedDetail>).detail;
      resetWorkingFingerprints(detail?.keys);
    };

    const handleCoreReconciled = (event: Event) => {
      const detail = (event as CustomEvent<CoreCloudReconciledDetail>).detail;
      if (detail?.uid !== uid || disposed) return;
      coreReconciled = true;
      clearRetryTimer();
      void flushPending();
    };

    const resumePendingSync = () => {
      if (disposed || !navigator.onLine) return;
      // Every foreground/reconnect cycle must reconcile cloud first. A stale
      // device may have durable pending state from before another device advanced
      // the same book; CrossDeviceDeltaSyncBridge decides which intent is newer.
      coreReconciled = false;
      clearRetryTimer();
    };

    const flushBeforeSignOut = (event: Event) => {
      const detail = (event as CustomEvent<BeforeSignOutDetail>).detail;
      if (detail?.uid !== uid) return;
      if (flushTimer !== undefined) {
        window.clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      clearRetryTimer();
      captureCurrentChanges();
      if (coreReconciled) detail.waitUntil(flushPending());
    };

    window.addEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, handleLocalChange);
    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, handleCloudUpdate);
    window.addEventListener(INKBOUND_CORE_RECONCILED_EVENT, handleCoreReconciled);
    window.addEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, flushBeforeSignOut);
    const unsubscribeRuntimeResume = subscribeToRuntimeResume(resumePendingSync);

    return () => {
      disposed = true;
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      clearRetryTimer();
      window.removeEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, handleLocalChange);
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, handleCloudUpdate);
      window.removeEventListener(INKBOUND_CORE_RECONCILED_EVENT, handleCoreReconciled);
      window.removeEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, flushBeforeSignOut);
      unsubscribeRuntimeResume();
    };
  }, [sync.user?.uid]);

  return null;
};
