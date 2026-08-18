import React, { useEffect, useRef } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  getDocsFromCache,
  onSnapshot,
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
  INKBOUND_LOCAL_DATA_CHANGED_EVENT,
  notifyCloudDataUpdated,
  type BeforeSignOutDetail,
} from './cloudSyncEvents';
import { shouldPromoteLocalRecordMissingFromCloud } from './syncConflictPolicy';

const localStorage = {
  getItem: (key: string) => getRuntimeStorage().getItem(key),
  setItem: (key: string, value: string) => getRuntimeStorage().setItem(key, value),
  removeItem: (key: string) => getRuntimeStorage().removeItem(key),
};

const BOOKS_KEY = 'inkbound_books';
const SESSIONS_KEY = 'inkbound_sessions';
const PROFILE_KEY = 'inkbound_reader_profile';
const BRIDGE_VERSION_KEY = 'inkbound_cloud_bridge_version';
const BRIDGE_VERSION = '5';
const LOCAL_CHANGE_POLL_MS = 1500;
const INITIAL_UPLOAD_BATCH_SIZE = 100;
const OWNER_UID_KEY = 'inkbound_local_data_owner_uid';
const INITIAL_SERVER_WAIT_MS = 8000;

interface CloudRecord<T> { data: T; clientUpdatedAt?: string }
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

const stable = (value: unknown) => JSON.stringify(value);
const pendingKey = (uid: string) => `inkbound_pending_sync_${uid}_v1`;
const baselineKey = (uid: string) => `inkbound_sync_baseline_${uid}_v1`;
const clearIntentKey = (uid: string) => `inkbound_local_clear_intent_${uid}`;
const emptyPending = (): PendingSyncState => ({ books: {}, sessions: {} });
const emptyBaseline = (): SyncBaseline => ({ books: {}, sessions: {} });

const safeParse = <T,>(key: string, fallback: T): T => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
};

const readPending = (uid: string) => safeParse<PendingSyncState>(pendingKey(uid), emptyPending());
const readBaseline = (uid: string) => safeParse<SyncBaseline>(baselineKey(uid), emptyBaseline());
const writeBaseline = (uid: string, value: SyncBaseline) => localStorage.setItem(baselineKey(uid), stable(value));
const writePending = (uid: string, value: PendingSyncState) => {
  if (!Object.keys(value.books).length && !Object.keys(value.sessions).length && !value.profile) {
    localStorage.removeItem(pendingKey(uid));
  } else {
    localStorage.setItem(pendingKey(uid), stable(value));
  }
};

const toFingerprintMap = <T extends { id: string }>(items: T[]) =>
  new Map(items.map((item) => [item.id, stable(item)]));

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Initial cloud hydration timed out.')), milliseconds);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

async function preferServerThenCache<T>(serverRead: () => Promise<T>, cacheRead: () => Promise<T>) {
  try { return await withTimeout(serverRead(), INITIAL_SERVER_WAIT_MS); }
  catch {
    try { return await cacheRead(); }
    catch { return undefined; }
  }
}

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

function captureAgainstBaseline<T extends { id: string }>(
  items: T[], baseline: Record<string, string>, mutations: Record<string, RecordMutation<T>>,
) {
  const localIds = new Set(items.map((item) => item.id));
  const now = new Date().toISOString();
  items.forEach((item) => {
    const fingerprint = stable(item);
    if (baseline[item.id] !== undefined && baseline[item.id] !== fingerprint && !mutations[item.id]) {
      mutations[item.id] = { operation: 'upsert', data: item, clientUpdatedAt: now };
    }
  });
  Object.keys(baseline).forEach((id) => {
    if (!localIds.has(id) && !mutations[id]) mutations[id] = { operation: 'delete', clientUpdatedAt: now };
  });
}

function captureWorkingChanges<T extends { id: string }>(
  items: T[], fingerprints: React.MutableRefObject<Map<string, string>>, mutations: Record<string, RecordMutation<T>>,
) {
  const next = toFingerprintMap(items);
  const now = new Date().toISOString();
  items.forEach((item) => {
    if (fingerprints.current.get(item.id) !== next.get(item.id)) {
      mutations[item.id] = { operation: 'upsert', data: item, clientUpdatedAt: now };
    }
  });
  fingerprints.current.forEach((_value, id) => {
    if (!next.has(id)) mutations[id] = { operation: 'delete', clientUpdatedAt: now };
  });
  fingerprints.current = next;
}

function applyPending<T extends { id: string }>(cloudItems: T[], mutations: Record<string, RecordMutation<T>>) {
  const merged = new Map(cloudItems.map((item) => [item.id, item]));
  Object.entries(mutations).forEach(([id, mutation]) => {
    if (mutation.operation === 'delete') merged.delete(id);
    else if (mutation.data) merged.set(id, mutation.data);
  });
  return [...merged.values()];
}

async function runInBatches(tasks: Array<() => Promise<unknown>>) {
  for (let index = 0; index < tasks.length; index += INITIAL_UPLOAD_BATCH_SIZE) {
    await Promise.all(tasks.slice(index, index + INITIAL_UPLOAD_BATCH_SIZE).map((task) => task()));
  }
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
      const tasks: Array<() => Promise<unknown>> = [];

      bookEntries.forEach(([id, mutation]) => tasks.push(async () => {
        const target = doc(db!, 'users', uid, 'books', id);
        if (mutation.operation === 'delete') await deleteDoc(target);
        else if (mutation.data) await setDoc(target, { data: mutation.data, updatedAt: serverTimestamp(), clientUpdatedAt: mutation.clientUpdatedAt }, { merge: true });
      }));
      sessionEntries.forEach(([id, mutation]) => tasks.push(async () => {
        const target = doc(db!, 'users', uid, 'sessions', id);
        if (mutation.operation === 'delete') await deleteDoc(target);
        else if (mutation.data) await setDoc(target, { data: mutation.data, updatedAt: serverTimestamp(), clientUpdatedAt: mutation.clientUpdatedAt }, { merge: true });
      }));
      if (tasks.length) await runInBatches(tasks);

      let preparedProfile: ReaderProfile | undefined;
      if (pending.profile) {
        preparedProfile = await prepareCloudProfile(uid, pending.profile.data);
        await setDoc(doc(db!, 'users', uid, 'profile', 'current'), {
          data: preparedProfile, updatedAt: serverTimestamp(), clientUpdatedAt: pending.profile.clientUpdatedAt,
        }, { merge: true });
      }

      const latest = readPending(uid);
      bookEntries.forEach(([id, mutation]) => {
        if (stable(latest.books[id]) !== stable(mutation)) return;
        if (mutation.operation === 'delete') delete baseline.books[id];
        else if (mutation.data) baseline.books[id] = stable(mutation.data);
        delete latest.books[id];
      });
      sessionEntries.forEach(([id, mutation]) => {
        if (stable(latest.sessions[id]) !== stable(mutation)) return;
        if (mutation.operation === 'delete') delete baseline.sessions[id];
        else if (mutation.data) baseline.sessions[id] = stable(mutation.data);
        delete latest.sessions[id];
      });
      if (pending.profile && preparedProfile && stable(latest.profile) === stable(pending.profile)) {
        const fingerprint = stable(preparedProfile);
        baseline.profile = fingerprint;
        profileFingerprint.current = fingerprint;
        localStorage.setItem(PROFILE_KEY, fingerprint);
        delete latest.profile;
        notifyCloudDataUpdated([PROFILE_KEY]);
      }
      writeBaseline(uid, baseline);
      writePending(uid, latest);
    };

    const captureCurrentChanges = () => {
      if (!hydrated.current || disposed || localStorage.getItem(clearIntentKey(uid)) === '1') return;
      const pending = readPending(uid);
      captureWorkingChanges(safeParse<UserBookRecord[]>(BOOKS_KEY, []), bookFingerprints, pending.books);
      captureWorkingChanges(safeParse<ReadingSession[]>(SESSIONS_KEY, []), sessionFingerprints, pending.sessions);
      const profile = safeParse<ReaderProfile>(PROFILE_KEY, {});
      const fingerprint = stable(profile);
      if (Object.keys(profile).length && fingerprint !== profileFingerprint.current) {
        pending.profile = { data: profile, clientUpdatedAt: new Date().toISOString() };
        profileFingerprint.current = fingerprint;
      }
      writePending(uid, pending);
    };

    const initialize = async () => {
      const previousOwnerUid = localStorage.getItem(OWNER_UID_KEY);
      const sameAccount = !previousOwnerUid || previousOwnerUid === uid;
      const intentionalClear = localStorage.getItem(clearIntentKey(uid)) === '1';
      let localBooks = sameAccount ? safeParse<UserBookRecord[]>(BOOKS_KEY, []) : [];
      let localSessions = sameAccount ? safeParse<ReadingSession[]>(SESSIONS_KEY, []) : [];
      let localProfile = sameAccount ? safeParse<ReaderProfile>(PROFILE_KEY, {}) : {};
      const baseline = readBaseline(uid);
      const pending = readPending(uid);

      if (sameAccount && !intentionalClear) {
        captureAgainstBaseline(localBooks, baseline.books, pending.books);
        captureAgainstBaseline(localSessions, baseline.sessions, pending.sessions);
        const profileFingerprintValue = stable(localProfile);
        if (baseline.profile && Object.keys(localProfile).length && profileFingerprintValue !== baseline.profile && !pending.profile) {
          pending.profile = { data: localProfile, clientUpdatedAt: new Date().toISOString() };
        }
      }

      const booksRef = collection(db!, 'users', uid, 'books');
      const sessionsRef = collection(db!, 'users', uid, 'sessions');
      const profileRef = doc(db!, 'users', uid, 'profile', 'current');
      const [bookSnapshot, sessionSnapshot, profileSnapshot] = await Promise.all([
        preferServerThenCache(() => getDocs(booksRef), () => getDocsFromCache(booksRef)),
        preferServerThenCache(() => getDocs(sessionsRef), () => getDocsFromCache(sessionsRef)),
        preferServerThenCache(() => getDoc(profileRef), () => getDocFromCache(profileRef)),
      ]);
      if (disposed) return;

      const cloudBooks = bookSnapshot ? bookSnapshot.docs.map((item) => (item.data() as CloudRecord<UserBookRecord>).data).filter(Boolean) : localBooks;
      const cloudSessions = sessionSnapshot ? sessionSnapshot.docs.map((item) => (item.data() as CloudRecord<ReadingSession>).data).filter(Boolean) : localSessions;
      const nextBaseline: SyncBaseline = {
        books: Object.fromEntries(cloudBooks.map((book) => [book.id, stable(book)])),
        sessions: Object.fromEntries(cloudSessions.map((session) => [session.id, stable(session)])),
        profile: baseline.profile,
      };

      if (sameAccount && !intentionalClear && bookSnapshot && sessionSnapshot) {
        const cloudBookIds = new Set(cloudBooks.map((book) => book.id));
        const cloudSessionIds = new Set(cloudSessions.map((session) => session.id));
        const now = new Date().toISOString();
        localBooks.forEach((book) => {
          if (shouldPromoteLocalRecordMissingFromCloud({
            hasCloudRecord: cloudBookIds.has(book.id),
            baselineFingerprint: baseline.books[book.id],
            hasPendingMutation: Boolean(pending.books[book.id]),
          })) pending.books[book.id] = { operation: 'upsert', data: book, clientUpdatedAt: now };
        });
        localSessions.forEach((session) => {
          if (shouldPromoteLocalRecordMissingFromCloud({
            hasCloudRecord: cloudSessionIds.has(session.id),
            baselineFingerprint: baseline.sessions[session.id],
            hasPendingMutation: Boolean(pending.sessions[session.id]),
          })) pending.sessions[session.id] = { operation: 'upsert', data: session, clientUpdatedAt: now };
        });
      }

      localBooks = applyPending(cloudBooks, pending.books);
      localSessions = applyPending(cloudSessions, pending.sessions);
      localStorage.setItem(BOOKS_KEY, stable(localBooks));
      localStorage.setItem(SESSIONS_KEY, stable(localSessions));
      bookFingerprints.current = toFingerprintMap(localBooks);
      sessionFingerprints.current = toFingerprintMap(localSessions);

      const cloudProfile = profileSnapshot?.exists() ? (profileSnapshot.data() as CloudRecord<ReaderProfile>).data : undefined;
      if (cloudProfile) nextBaseline.profile = stable(cloudProfile);
      if (pending.profile) localProfile = pending.profile.data;
      else if (cloudProfile) localProfile = cloudProfile;
      else if (sameAccount && Object.keys(localProfile).length && !intentionalClear) {
        pending.profile = { data: localProfile, clientUpdatedAt: new Date().toISOString() };
      } else if (!sameAccount || intentionalClear) localProfile = {};

      profileFingerprint.current = stable(localProfile);
      localStorage.setItem(PROFILE_KEY, profileFingerprint.current);
      writeBaseline(uid, nextBaseline);
      writePending(uid, pending);
      localStorage.setItem(OWNER_UID_KEY, uid);
      localStorage.removeItem(clearIntentKey(uid));

      const subscribeCollection = <T extends { id: string }>(
        name: 'books' | 'sessions', storageKey: string,
        fingerprints: React.MutableRefObject<Map<string, string>>,
        pendingSelector: (state: PendingSyncState) => Record<string, RecordMutation<T>>,
        baselineSelector: (state: SyncBaseline) => Record<string, string>,
      ) => onSnapshot(collection(db!, 'users', uid, name), (snapshot) => {
        if (!hydrated.current) return;
        const currentPending = pendingSelector(readPending(uid));
        const currentBaseline = readBaseline(uid);
        const baselineCollection = baselineSelector(currentBaseline);
        let current = safeParse<T[]>(storageKey, []);
        let changed = false;
        let baselineChanged = false;
        snapshot.docChanges().forEach((change) => {
          const id = change.doc.id;
          if (currentPending[id]) return;
          if (change.type === 'removed') {
            const next = current.filter((item) => item.id !== id);
            changed ||= next.length !== current.length;
            current = next;
            fingerprints.current.delete(id);
            if (baselineCollection[id] !== undefined) { delete baselineCollection[id]; baselineChanged = true; }
            return;
          }
          const record = (change.doc.data() as CloudRecord<T>).data;
          if (!record) return;
          const serialized = stable(record);
          const index = current.findIndex((item) => item.id === record.id);
          if (index >= 0) {
            if (stable(current[index]) !== serialized) { current[index] = record; changed = true; }
          } else { current.push(record); changed = true; }
          fingerprints.current.set(record.id, serialized);
          if (baselineCollection[record.id] !== serialized) { baselineCollection[record.id] = serialized; baselineChanged = true; }
        });
        if (baselineChanged) writeBaseline(uid, currentBaseline);
        if (changed) { localStorage.setItem(storageKey, stable(current)); notifyCloudDataUpdated([storageKey]); }
      }, () => undefined);

      unsubscribers.push(
        subscribeCollection<UserBookRecord>('books', BOOKS_KEY, bookFingerprints, (state) => state.books, (state) => state.books),
        subscribeCollection<ReadingSession>('sessions', SESSIONS_KEY, sessionFingerprints, (state) => state.sessions, (state) => state.sessions),
        onSnapshot(profileRef, (snapshot) => {
          if (!hydrated.current || !snapshot.exists() || readPending(uid).profile) return;
          const cloudValue = (snapshot.data() as CloudRecord<ReaderProfile>).data;
          if (!cloudValue) return;
          const fingerprint = stable(cloudValue);
          const currentBaseline = readBaseline(uid);
          if (currentBaseline.profile !== fingerprint) { currentBaseline.profile = fingerprint; writeBaseline(uid, currentBaseline); }
          if (fingerprint !== profileFingerprint.current) {
            profileFingerprint.current = fingerprint;
            localStorage.setItem(PROFILE_KEY, fingerprint);
            notifyCloudDataUpdated([PROFILE_KEY]);
          }
        }, () => undefined),
      );

      hydrated.current = true;
      localStorage.setItem(BRIDGE_VERSION_KEY, BRIDGE_VERSION);
      notifyCloudDataUpdated([BOOKS_KEY, SESSIONS_KEY, PROFILE_KEY]);
      try { await flushPending(); } catch { /* durable queue retries below */ }
    };

    void initialize().catch(() => {
      if (disposed) return;
      const ownerUid = localStorage.getItem(OWNER_UID_KEY);
      if (!ownerUid || ownerUid === uid) {
        localStorage.setItem(OWNER_UID_KEY, uid);
        localStorage.removeItem(clearIntentKey(uid));
      }
      hydrated.current = true;
      notifyCloudDataUpdated([BOOKS_KEY, SESSIONS_KEY, PROFILE_KEY]);
    });

    const poll = window.setInterval(async () => {
      if (!hydrated.current || disposed || pollRunning.current) return;
      pollRunning.current = true;
      try { captureCurrentChanges(); await flushPending(); }
      catch { /* offline/transient failures remain queued */ }
      finally { pollRunning.current = false; }
    }, LOCAL_CHANGE_POLL_MS);

    const preservePending = () => captureCurrentChanges();
    const syncImmediately = () => {
      if (!hydrated.current || disposed) return;
      captureCurrentChanges();
      void flushPending().catch(() => undefined);
    };
    const flushBeforeSignOut = (event: Event) => {
      const detail = (event as CustomEvent<BeforeSignOutDetail>).detail;
      if (detail?.uid !== uid) return;
      captureCurrentChanges();
      detail.waitUntil(flushPending());
    };

    window.addEventListener('pagehide', preservePending);
    document.addEventListener('visibilitychange', preservePending);
    window.addEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, syncImmediately);
    window.addEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, flushBeforeSignOut);
    return () => {
      preservePending();
      disposed = true;
      window.clearInterval(poll);
      window.removeEventListener('pagehide', preservePending);
      document.removeEventListener('visibilitychange', preservePending);
      window.removeEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, syncImmediately);
      window.removeEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, flushBeforeSignOut);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [sync.user?.uid]);

  return null;
};
