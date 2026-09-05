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
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import {
  INKBOUND_BEFORE_SIGN_OUT_EVENT,
  INKBOUND_CLOUD_DATA_EVENT,
  INKBOUND_LOCAL_DATA_CHANGED_EVENT,
  type BeforeSignOutDetail,
  type CloudDataUpdatedDetail,
  type CloudSyncedStorageKey,
  type LocalDataChangedDetail,
} from './cloudSyncEvents';

const BOOKS_KEY: CloudSyncedStorageKey = 'inkbound_books';
const SESSIONS_KEY: CloudSyncedStorageKey = 'inkbound_sessions';
const PROFILE_KEY: CloudSyncedStorageKey = 'inkbound_reader_profile';
const OWNER_UID_KEY = 'inkbound_local_data_owner_uid';
const SYNC_FLUSH_DEBOUNCE_MS = 3000;
const UPLOAD_BATCH_SIZE = 100;
const CHECKPOINT_BATCH_SIZE = 500;

interface ReaderProfile {
  displayName?: string;
  email?: string;
  favoriteQuote?: string;
  bio?: string;
  avatarImage?: string;
  bannerImage?: string;
}

type MutationOperation = 'upsert' | 'delete';
interface RecordMutation<T> { operation: MutationOperation; data?: T; clientUpdatedAt: string }
interface ProfileMutation { data: ReaderProfile; clientUpdatedAt: string }
interface PendingSyncState {
  books: Record<string, RecordMutation<UserBookRecord>>;
  sessions: Record<string, RecordMutation<ReadingSession>>;
  profile?: ProfileMutation;
}
interface SyncBaseline { books: Record<string, string>; sessions: Record<string, string>; profile?: string }

const runtimeStorage = () => getRuntimeStorage();
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
const pendingKey = (uid: string) => `inkbound_pending_sync_${uid}_v1`;
const baselineKey = (uid: string) => `inkbound_sync_baseline_${uid}_v2`;
const clearIntentKey = (uid: string) => `inkbound_local_clear_intent_${uid}`;
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

const readPending = (uid: string) => readJson<PendingSyncState>(pendingKey(uid), emptyPending());
const readBaseline = (uid: string) => readJson<SyncBaseline>(baselineKey(uid), emptyBaseline());
const writeBaseline = (uid: string, value: SyncBaseline) => runtimeStorage().setItem(baselineKey(uid), stable(value));
const writePending = (uid: string, value: PendingSyncState) => {
  if (!Object.keys(value.books).length && !Object.keys(value.sessions).length && !value.profile) {
    runtimeStorage().removeItem(pendingKey(uid));
  } else {
    runtimeStorage().setItem(pendingKey(uid), stable(value));
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
  const imageRef = ref(storage, `users/${uid}/profile/${kind}-${hashText(value)}.webp`);
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
    let flushTimer: number | undefined;
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
    runtimeStorage().setItem(OWNER_UID_KEY, uid);

    const checkpointRecordBatch = <T,>(
      kind: 'books' | 'sessions',
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

    const uploadRecordEntries = async <T,>(
      kind: 'books' | 'sessions',
      entries: Array<[string, RecordMutation<T>]>,
    ) => {
      let checkpointEntries: Array<[string, RecordMutation<T>]> = [];
      for (let index = 0; index < entries.length; index += UPLOAD_BATCH_SIZE) {
        if (disposed) return;
        const batch = entries.slice(index, index + UPLOAD_BATCH_SIZE);
        await Promise.all(batch.map(async ([id, mutation]) => {
          const target = doc(db!, 'users', uid, kind, id);
          if (mutation.operation === 'delete') await deleteDoc(target);
          else if (mutation.data) {
            await setDoc(target, {
              data: mutation.data,
              updatedAt: serverTimestamp(),
              clientUpdatedAt: mutation.clientUpdatedAt,
            }, { merge: true });
          }
        }));

        checkpointEntries.push(...batch);
        if (checkpointEntries.length >= CHECKPOINT_BATCH_SIZE || index + UPLOAD_BATCH_SIZE >= entries.length) {
          checkpointRecordBatch(kind, checkpointEntries);
          checkpointEntries = [];
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      }
    };

    const performFlushPending = async () => {
      if (!navigator.onLine || disposed) return;
      const pending = readPending(uid);
      const baseline = readBaseline(uid);
      removeNoOpMutations(pending.books, baseline.books);
      removeNoOpMutations(pending.sessions, baseline.sessions);
      if (pending.profile && baseline.profile === stable(pending.profile.data)) delete pending.profile;
      writePending(uid, pending);

      await uploadRecordEntries<UserBookRecord>('books', Object.entries(pending.books));
      await uploadRecordEntries<ReadingSession>('sessions', Object.entries(pending.sessions));

      const latestBeforeProfile = readPending(uid);
      if (pending.profile && stable(latestBeforeProfile.profile) === stable(pending.profile)) {
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
          runtimeStorage().setItem(PROFILE_KEY, preparedValue);
          profileFingerprint.current = preparedValue;
        }
      }
    };

    const flushPending = (): Promise<void> => {
      flushRequested = true;
      if (flushInFlight) return flushInFlight;
      flushInFlight = (async () => {
        while (flushRequested && !disposed) {
          flushRequested = false;
          await performFlushPending();
        }
      })().finally(() => { flushInFlight = undefined; });
      return flushInFlight;
    };

    const captureCurrentChanges = (keys?: CloudSyncedStorageKey[]) => {
      if (disposed || runtimeStorage().getItem(clearIntentKey(uid)) === '1') return;
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
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(() => {
        flushTimer = undefined;
        void flushPending().catch(() => undefined);
      }, SYNC_FLUSH_DEBOUNCE_MS);
    };

    const handleLocalChange = (event: Event) => {
      const detail = (event as CustomEvent<LocalDataChangedDetail>).detail;
      captureCurrentChanges(detail?.keys);
      scheduleFlush();
    };

    const handleCloudUpdate = (event: Event) => {
      const detail = (event as CustomEvent<CloudDataUpdatedDetail>).detail;
      // Explicit server refresh/recovery has already written the accepted cloud
      // values locally. Treat them as the new working state instead of echoing
      // the whole refreshed library back to Firestore.
      resetWorkingFingerprints(detail?.keys);
    };

    const resumePendingSync = () => {
      if (disposed || !navigator.onLine) return;
      void flushPending().catch(() => undefined);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') resumePendingSync();
    };

    const flushBeforeSignOut = (event: Event) => {
      const detail = (event as CustomEvent<BeforeSignOutDetail>).detail;
      if (detail?.uid !== uid) return;
      if (flushTimer !== undefined) {
        window.clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      captureCurrentChanges();
      detail.waitUntil(flushPending());
    };

    window.addEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, handleLocalChange);
    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, handleCloudUpdate);
    window.addEventListener('online', resumePendingSync);
    window.addEventListener('focus', resumePendingSync);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, flushBeforeSignOut);

    // Existing durable work resumes without first rereading the whole library.
    if (navigator.onLine) void flushPending().catch(() => undefined);

    return () => {
      disposed = true;
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      window.removeEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, handleLocalChange);
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, handleCloudUpdate);
      window.removeEventListener('online', resumePendingSync);
      window.removeEventListener('focus', resumePendingSync);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, flushBeforeSignOut);
    };
  }, [sync.user?.uid]);

  return null;
};
