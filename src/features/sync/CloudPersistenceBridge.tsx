import React, { useEffect, useRef } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import type { ReadingSession, UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db, storage } from '../../lib/firebase';
import { notifyCloudDataUpdated } from './cloudSyncEvents';

const BOOKS_KEY = 'inkbound_books';
const SESSIONS_KEY = 'inkbound_sessions';
const PROFILE_KEY = 'inkbound_reader_profile';
const BRIDGE_VERSION_KEY = 'inkbound_cloud_bridge_version';
const BRIDGE_VERSION = '3';
const LOCAL_CHANGE_POLL_MS = 1500;
const INITIAL_UPLOAD_BATCH_SIZE = 100;
const OWNER_UID_KEY = 'inkbound_local_data_owner_uid';

interface CloudRecord<T> {
  data: T;
  clientUpdatedAt?: string;
}

interface ReaderProfile {
  displayName?: string;
  email?: string;
  favoriteQuote?: string;
  bio?: string;
  avatarImage?: string;
  bannerImage?: string;
}

type MutationOperation = 'upsert' | 'delete';

interface RecordMutation<T> {
  operation: MutationOperation;
  data?: T;
  clientUpdatedAt: string;
}

interface ProfileMutation {
  data: ReaderProfile;
  clientUpdatedAt: string;
}

interface PendingSyncState {
  books: Record<string, RecordMutation<UserBookRecord>>;
  sessions: Record<string, RecordMutation<ReadingSession>>;
  profile?: ProfileMutation;
}

interface SyncBaseline {
  books: Record<string, string>;
  sessions: Record<string, string>;
  profile?: string;
}

const safeParse = <T,>(key: string, fallback: T): T => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
};

const stable = (value: unknown) => JSON.stringify(value);

const toFingerprintMap = <T extends { id: string }>(items: T[]) =>
  new Map(items.map((item) => [item.id, stable(item)]));

const pendingKey = (uid: string) => `inkbound_pending_sync_${uid}_v1`;
const baselineKey = (uid: string) => `inkbound_sync_baseline_${uid}_v1`;
const clearIntentKey = (uid: string) => `inkbound_local_clear_intent_${uid}`;

const emptyPending = (): PendingSyncState => ({ books: {}, sessions: {} });
const emptyBaseline = (): SyncBaseline => ({ books: {}, sessions: {} });

const readPending = (uid: string): PendingSyncState =>
  safeParse<PendingSyncState>(pendingKey(uid), emptyPending());

const writePending = (uid: string, pending: PendingSyncState) => {
  if (
    Object.keys(pending.books).length === 0 &&
    Object.keys(pending.sessions).length === 0 &&
    !pending.profile
  ) {
    localStorage.removeItem(pendingKey(uid));
    return;
  }
  localStorage.setItem(pendingKey(uid), stable(pending));
};

const readBaseline = (uid: string): SyncBaseline =>
  safeParse<SyncBaseline>(baselineKey(uid), emptyBaseline());

const writeBaseline = (uid: string, baseline: SyncBaseline) => {
  localStorage.setItem(baselineKey(uid), stable(baseline));
};

const isDataImage = (value?: string) => Boolean(value?.startsWith('data:image/'));

const hashText = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

async function optimizeProfileImage(value: string, kind: 'avatar' | 'banner'): Promise<Blob> {
  const source = await fetch(value).then((response) => response.blob());
  const bitmap = await createImageBitmap(source);
  const maximumWidth = kind === 'avatar' ? 512 : 1600;
  const maximumHeight = kind === 'avatar' ? 512 : 700;
  const scale = Math.min(1, maximumWidth / bitmap.width, maximumHeight / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return source;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise<Blob>((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ?? source),
      'image/webp',
      kind === 'avatar' ? 0.84 : 0.8,
    );
  });
}

async function uploadProfileImage(
  uid: string,
  kind: 'avatar' | 'banner',
  value?: string,
): Promise<string | undefined> {
  if (!value || !isDataImage(value) || !storage) return value;
  const contentHash = hashText(value);
  const blob = await optimizeProfileImage(value, kind);
  const imageRef = ref(storage, `users/${uid}/profile/${kind}-${contentHash}.webp`);
  await uploadBytes(imageRef, blob, {
    contentType: 'image/webp',
    cacheControl: 'public,max-age=31536000,immutable',
  });
  return getDownloadURL(imageRef);
}

async function prepareCloudProfile(uid: string, profile: ReaderProfile): Promise<ReaderProfile> {
  const [avatarImage, bannerImage] = await Promise.all([
    uploadProfileImage(uid, 'avatar', profile.avatarImage),
    uploadProfileImage(uid, 'banner', profile.bannerImage),
  ]);
  return { ...profile, avatarImage, bannerImage };
}

async function runInBatches(tasks: Array<() => Promise<unknown>>) {
  for (let index = 0; index < tasks.length; index += INITIAL_UPLOAD_BATCH_SIZE) {
    await Promise.all(tasks.slice(index, index + INITIAL_UPLOAD_BATCH_SIZE).map((task) => task()));
  }
}

function captureAgainstBaseline<T extends { id: string }>(
  localItems: T[],
  baseline: Record<string, string>,
  mutations: Record<string, RecordMutation<T>>,
) {
  const localById = new Map(localItems.map((item) => [item.id, item]));
  const now = new Date().toISOString();

  localItems.forEach((item) => {
    const fingerprint = stable(item);
    if (baseline[item.id] !== undefined && baseline[item.id] !== fingerprint && !mutations[item.id]) {
      mutations[item.id] = { operation: 'upsert', data: item, clientUpdatedAt: now };
    }
  });

  Object.keys(baseline).forEach((id) => {
    if (!localById.has(id) && !mutations[id]) {
      mutations[id] = { operation: 'delete', clientUpdatedAt: now };
    }
  });
}

function captureWorkingChanges<T extends { id: string }>(
  items: T[],
  fingerprints: React.MutableRefObject<Map<string, string>>,
  mutations: Record<string, RecordMutation<T>>,
) {
  const nextFingerprints = toFingerprintMap(items);
  const now = new Date().toISOString();

  items.forEach((item) => {
    const fingerprint = nextFingerprints.get(item.id)!;
    if (fingerprints.current.get(item.id) !== fingerprint) {
      mutations[item.id] = { operation: 'upsert', data: item, clientUpdatedAt: now };
    }
  });

  Array.from(fingerprints.current.keys()).forEach((id) => {
    if (!nextFingerprints.has(id)) {
      mutations[id] = { operation: 'delete', clientUpdatedAt: now };
    }
  });

  fingerprints.current = nextFingerprints;
}

function applyPendingToRecords<T extends { id: string }>(
  cloudItems: T[],
  mutations: Record<string, RecordMutation<T>>,
): T[] {
  const merged = new Map(cloudItems.map((item) => [item.id, item]));
  Object.entries(mutations).forEach(([id, mutation]) => {
    if (mutation.operation === 'delete') {
      merged.delete(id);
      return;
    }
    if (mutation.data) merged.set(id, mutation.data);
  });
  return Array.from(merged.values());
}

export const CloudPersistenceBridge: React.FC = () => {
  const sync = useAccountSync();
  const hydrated = useRef(false);
  const bookFingerprints = useRef(new Map<string, string>());
  const sessionFingerprints = useRef(new Map<string, string>());
  const profileFingerprint = useRef('');
  const pollRunning = useRef(false);

  useEffect(() => {
    hydrated.current = false;
    bookFingerprints.current.clear();
    sessionFingerprints.current.clear();
    profileFingerprint.current = '';
    pollRunning.current = false;

    if (!sync.user || !db) return undefined;
    const uid = sync.user.uid;
    let disposed = false;
    const unsubscribers: Array<() => void> = [];

    const flushPending = async () => {
      const pending = readPending(uid);
      const baseline = readBaseline(uid);
      const bookEntries = Object.entries(pending.books);
      const sessionEntries = Object.entries(pending.sessions);
      const profileMutation = pending.profile;

      const tasks: Array<() => Promise<unknown>> = [
        ...bookEntries.map(([id, mutation]) => async () => {
          if (mutation.operation === 'delete') {
            await deleteDoc(doc(db!, 'users', uid, 'books', id));
          } else if (mutation.data) {
            await setDoc(
              doc(db!, 'users', uid, 'books', id),
              {
                data: mutation.data,
                updatedAt: serverTimestamp(),
                clientUpdatedAt: mutation.clientUpdatedAt,
              },
              { merge: true },
            );
          }
        }),
        ...sessionEntries.map(([id, mutation]) => async () => {
          if (mutation.operation === 'delete') {
            await deleteDoc(doc(db!, 'users', uid, 'sessions', id));
          } else if (mutation.data) {
            await setDoc(
              doc(db!, 'users', uid, 'sessions', id),
              {
                data: mutation.data,
                updatedAt: serverTimestamp(),
                clientUpdatedAt: mutation.clientUpdatedAt,
              },
              { merge: true },
            );
          }
        }),
      ];

      if (tasks.length > 0) await runInBatches(tasks);

      let preparedProfile: ReaderProfile | undefined;
      if (profileMutation) {
        preparedProfile = await prepareCloudProfile(uid, profileMutation.data);
        await setDoc(
          doc(db!, 'users', uid, 'profile', 'current'),
          {
            data: preparedProfile,
            updatedAt: serverTimestamp(),
            clientUpdatedAt: profileMutation.clientUpdatedAt,
          },
          { merge: true },
        );
      }

      const latestPending = readPending(uid);
      bookEntries.forEach(([id, mutation]) => {
        if (stable(latestPending.books[id]) !== stable(mutation)) return;
        if (mutation.operation === 'delete') delete baseline.books[id];
        else if (mutation.data) baseline.books[id] = stable(mutation.data);
        delete latestPending.books[id];
      });
      sessionEntries.forEach(([id, mutation]) => {
        if (stable(latestPending.sessions[id]) !== stable(mutation)) return;
        if (mutation.operation === 'delete') delete baseline.sessions[id];
        else if (mutation.data) baseline.sessions[id] = stable(mutation.data);
        delete latestPending.sessions[id];
      });
      if (
        profileMutation &&
        stable(latestPending.profile) === stable(profileMutation) &&
        preparedProfile
      ) {
        const preparedFingerprint = stable(preparedProfile);
        baseline.profile = preparedFingerprint;
        profileFingerprint.current = preparedFingerprint;
        localStorage.setItem(PROFILE_KEY, preparedFingerprint);
        delete latestPending.profile;
        notifyCloudDataUpdated([PROFILE_KEY]);
      }

      writeBaseline(uid, baseline);
      writePending(uid, latestPending);
    };

    const captureCurrentChanges = () => {
      if (
        !hydrated.current ||
        disposed ||
        localStorage.getItem(clearIntentKey(uid)) === '1'
      ) return;

      const pending = readPending(uid);
      const localBooks = safeParse<UserBookRecord[]>(BOOKS_KEY, []);
      const localSessions = safeParse<ReadingSession[]>(SESSIONS_KEY, []);
      const localProfile = safeParse<ReaderProfile>(PROFILE_KEY, {});

      captureWorkingChanges(localBooks, bookFingerprints, pending.books);
      captureWorkingChanges(localSessions, sessionFingerprints, pending.sessions);

      const nextProfileFingerprint = stable(localProfile);
      if (
        Object.keys(localProfile).length > 0 &&
        nextProfileFingerprint !== profileFingerprint.current
      ) {
        pending.profile = {
          data: localProfile,
          clientUpdatedAt: new Date().toISOString(),
        };
        profileFingerprint.current = nextProfileFingerprint;
      }

      writePending(uid, pending);
    };

    const initialize = async () => {
      const previousOwnerUid = localStorage.getItem(OWNER_UID_KEY);
      const sameAccountLocalData = !previousOwnerUid || previousOwnerUid === uid;
      const intentionalLocalClear = localStorage.getItem(clearIntentKey(uid)) === '1';
      let localBooks = sameAccountLocalData ? safeParse<UserBookRecord[]>(BOOKS_KEY, []) : [];
      let localSessions = sameAccountLocalData ? safeParse<ReadingSession[]>(SESSIONS_KEY, []) : [];
      let localProfile = sameAccountLocalData ? safeParse<ReaderProfile>(PROFILE_KEY, {}) : {};
      const baseline = readBaseline(uid);
      const pending = readPending(uid);

      if (!intentionalLocalClear && sameAccountLocalData) {
        captureAgainstBaseline(localBooks, baseline.books, pending.books);
        captureAgainstBaseline(localSessions, baseline.sessions, pending.sessions);
        const localProfileFingerprint = stable(localProfile);
        if (
          baseline.profile &&
          Object.keys(localProfile).length > 0 &&
          localProfileFingerprint !== baseline.profile &&
          !pending.profile
        ) {
          pending.profile = {
            data: localProfile,
            clientUpdatedAt: new Date().toISOString(),
          };
        }
      }

      const [bookSnapshot, sessionSnapshot] = await Promise.all([
        getDocs(collection(db!, 'users', uid, 'books')),
        getDocs(collection(db!, 'users', uid, 'sessions')),
      ]);
      if (disposed) return;

      const cloudBooks = bookSnapshot.docs
        .map((item) => (item.data() as CloudRecord<UserBookRecord>).data)
        .filter(Boolean);
      const cloudSessions = sessionSnapshot.docs
        .map((item) => (item.data() as CloudRecord<ReadingSession>).data)
        .filter(Boolean);

      const nextBaseline: SyncBaseline = {
        books: Object.fromEntries(cloudBooks.map((book) => [book.id, stable(book)])),
        sessions: Object.fromEntries(cloudSessions.map((session) => [session.id, stable(session)])),
        profile: baseline.profile,
      };

      if (sameAccountLocalData && !intentionalLocalClear) {
        const cloudBookIds = new Set(cloudBooks.map((book) => book.id));
        const cloudSessionIds = new Set(cloudSessions.map((session) => session.id));
        const now = new Date().toISOString();

        localBooks.forEach((book) => {
          if (!cloudBookIds.has(book.id) && !pending.books[book.id]) {
            pending.books[book.id] = { operation: 'upsert', data: book, clientUpdatedAt: now };
          }
        });
        localSessions.forEach((session) => {
          if (!cloudSessionIds.has(session.id) && !pending.sessions[session.id]) {
            pending.sessions[session.id] = { operation: 'upsert', data: session, clientUpdatedAt: now };
          }
        });
      }

      localBooks = applyPendingToRecords(cloudBooks, pending.books);
      localSessions = applyPendingToRecords(cloudSessions, pending.sessions);

      localStorage.setItem(BOOKS_KEY, stable(localBooks));
      localStorage.setItem(SESSIONS_KEY, stable(localSessions));
      bookFingerprints.current = toFingerprintMap(localBooks);
      sessionFingerprints.current = toFingerprintMap(localSessions);

      const profileRef = doc(db!, 'users', uid, 'profile', 'current');
      const cloudProfileSnapshot = await getDoc(profileRef);
      const cloudProfile = cloudProfileSnapshot.exists()
        ? (cloudProfileSnapshot.data() as CloudRecord<ReaderProfile>).data
        : undefined;

      if (cloudProfile) nextBaseline.profile = stable(cloudProfile);

      if (pending.profile) {
        localProfile = pending.profile.data;
      } else if (cloudProfile) {
        localProfile = cloudProfile;
      } else if (sameAccountLocalData && Object.keys(localProfile).length > 0 && !intentionalLocalClear) {
        pending.profile = {
          data: localProfile,
          clientUpdatedAt: new Date().toISOString(),
        };
      } else {
        localProfile = {};
      }

      profileFingerprint.current = stable(localProfile);
      localStorage.setItem(PROFILE_KEY, profileFingerprint.current);
      writeBaseline(uid, nextBaseline);
      writePending(uid, pending);
      localStorage.setItem(OWNER_UID_KEY, uid);
      localStorage.removeItem(clearIntentKey(uid));

      const subscribeCollection = <T extends { id: string }>(
        name: 'books' | 'sessions',
        storageKey: 'inkbound_books' | 'inkbound_sessions',
        fingerprints: React.MutableRefObject<Map<string, string>>,
        getPendingCollection: (state: PendingSyncState) => Record<string, RecordMutation<T>>,
        getBaselineCollection: (state: SyncBaseline) => Record<string, string>,
      ) => onSnapshot(collection(db!, 'users', uid, name), (snapshot) => {
        if (!hydrated.current) return;
        const currentPending = readPending(uid);
        const collectionPending = getPendingCollection(currentPending);
        const currentBaseline = readBaseline(uid);
        const baselineCollection = getBaselineCollection(currentBaseline);
        let current = safeParse<T[]>(storageKey, []);
        let changed = false;
        let baselineChanged = false;

        snapshot.docChanges().forEach((change) => {
          const id = change.doc.id;
          if (collectionPending[id]) return;

          if (change.type === 'removed') {
            const next = current.filter((item) => item.id !== id);
            changed = changed || next.length !== current.length;
            current = next;
            fingerprints.current.delete(id);
            if (baselineCollection[id] !== undefined) {
              delete baselineCollection[id];
              baselineChanged = true;
            }
            return;
          }

          const record = (change.doc.data() as CloudRecord<T>).data;
          if (!record) return;
          const serialized = stable(record);
          const index = current.findIndex((item) => item.id === record.id);
          if (index >= 0) {
            if (stable(current[index]) !== serialized) {
              current[index] = record;
              changed = true;
            }
          } else {
            current.push(record);
            changed = true;
          }
          fingerprints.current.set(record.id, serialized);
          if (baselineCollection[record.id] !== serialized) {
            baselineCollection[record.id] = serialized;
            baselineChanged = true;
          }
        });

        if (baselineChanged) writeBaseline(uid, currentBaseline);
        if (!changed) return;
        localStorage.setItem(storageKey, stable(current));
        notifyCloudDataUpdated([storageKey]);
      });

      const unsubscribeProfile = onSnapshot(profileRef, (snapshot) => {
        if (!hydrated.current || !snapshot.exists()) return;
        const currentPending = readPending(uid);
        if (currentPending.profile) return;
        const cloudValue = (snapshot.data() as CloudRecord<ReaderProfile>).data;
        if (!cloudValue) return;
        const fingerprint = stable(cloudValue);
        const currentBaseline = readBaseline(uid);
        if (currentBaseline.profile !== fingerprint) {
          currentBaseline.profile = fingerprint;
          writeBaseline(uid, currentBaseline);
        }
        if (fingerprint === profileFingerprint.current) return;
        profileFingerprint.current = fingerprint;
        localStorage.setItem(PROFILE_KEY, fingerprint);
        notifyCloudDataUpdated([PROFILE_KEY]);
      });

      unsubscribers.push(
        subscribeCollection<UserBookRecord>(
          'books',
          BOOKS_KEY,
          bookFingerprints,
          (state) => state.books,
          (state) => state.books,
        ),
        subscribeCollection<ReadingSession>(
          'sessions',
          SESSIONS_KEY,
          sessionFingerprints,
          (state) => state.sessions,
          (state) => state.sessions,
        ),
        unsubscribeProfile,
      );

      hydrated.current = true;
      localStorage.setItem(BRIDGE_VERSION_KEY, BRIDGE_VERSION);
      notifyCloudDataUpdated([BOOKS_KEY, SESSIONS_KEY, PROFILE_KEY]);

      try {
        await flushPending();
      } catch {
        // Pending mutations remain durable in localStorage and will retry later.
      }
    };

    void initialize();

    const poll = window.setInterval(async () => {
      if (!hydrated.current || disposed || pollRunning.current) return;
      pollRunning.current = true;
      try {
        captureCurrentChanges();
        await flushPending();
      } catch {
        // Offline or transient failures are expected; pending mutations stay queued.
      } finally {
        pollRunning.current = false;
      }
    }, LOCAL_CHANGE_POLL_MS);

    const preservePendingBeforeBackgrounding = () => captureCurrentChanges();
    window.addEventListener('pagehide', preservePendingBeforeBackgrounding);
    document.addEventListener('visibilitychange', preservePendingBeforeBackgrounding);

    return () => {
      preservePendingBeforeBackgrounding();
      disposed = true;
      window.clearInterval(poll);
      window.removeEventListener('pagehide', preservePendingBeforeBackgrounding);
      document.removeEventListener('visibilitychange', preservePendingBeforeBackgrounding);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [sync.user?.uid]);

  return null;
};
