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
  type CloudSyncedStorageKey,
  type LocalDataChangedDetail,
} from './cloudSyncEvents';
import { shouldPromoteLocalRecordMissingFromCloud } from './syncConflictPolicy';
import { SYNC_STORAGE_KEYS } from './storageKeys';

const localStorage = {
  getItem: (key: string) => getRuntimeStorage().getItem(key),
  setItem: (key: string, value: string) => getRuntimeStorage().setItem(key, value),
  removeItem: (key: string) => getRuntimeStorage().removeItem(key),
};

const BOOKS_KEY: CloudSyncedStorageKey = 'inkbound_books';
const SESSIONS_KEY: CloudSyncedStorageKey = 'inkbound_sessions';
const PROFILE_KEY: CloudSyncedStorageKey = SYNC_STORAGE_KEYS.profile;
const BRIDGE_VERSION_KEY = 'inkbound_cloud_bridge_version';
const BRIDGE_VERSION = '11';
const SYNC_FLUSH_DEBOUNCE_MS = 3000;
const INITIAL_UPLOAD_BATCH_SIZE = 100;
const CHECKPOINT_BATCH_SIZE = 500;
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
// v2 stores compact hashes instead of full serialized records. This keeps a
// 40k+ library from duplicating the whole library again inside the baseline.
const baselineKey = (uid: string) => `inkbound_sync_baseline_${uid}_v2`;
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
  new Map(items.map((item) => [item.id, fingerprint(item)]));

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

function activeEdition(book: UserBookRecord) {
  return book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];
}

function metadataRichness(book: UserBookRecord): number {
  const edition = activeEdition(book);
  let score = book.importMetadataVerified === true ? 8 : 0;
  if (edition?.coverUrl) score += 5;
  if (book.work.publisherSummary?.trim()) score += 3;
  if (book.work.externalWorkId) score += 2;
  if (edition?.isbn13 || edition?.isbn10 || edition?.isbn) score += 2;
  if (edition?.pageCount) score += 1;
  if (edition?.publisher) score += 1;
  if (edition?.publicationDate) score += 1;
  if (book.work.genres?.length) score += 1;
  return score;
}

function mergeRicherLocalMetadata(localBook: UserBookRecord, cloudBook: UserBookRecord): UserBookRecord {
  const localEdition = activeEdition(localBook);
  const cloudEdition = activeEdition(cloudBook);
  const mergedEdition = cloudEdition && localEdition
    ? {
        ...localEdition,
        ...cloudEdition,
        id: cloudEdition.id,
        format: cloudEdition.format,
        coverGradient: cloudEdition.coverGradient || localEdition.coverGradient,
        coverUrl: cloudEdition.coverUrl || localEdition.coverUrl,
        isbn: cloudEdition.isbn || localEdition.isbn,
        isbn10: cloudEdition.isbn10 || localEdition.isbn10,
        isbn13: cloudEdition.isbn13 || localEdition.isbn13,
        pageCount: cloudEdition.pageCount || localEdition.pageCount,
        publisher: cloudEdition.publisher || localEdition.publisher,
        publicationDate: cloudEdition.publicationDate || localEdition.publicationDate,
        language: cloudEdition.language || localEdition.language,
        editionName: cloudEdition.editionName || localEdition.editionName,
        binding: cloudEdition.binding || localEdition.binding,
        specialFeatures: cloudEdition.specialFeatures?.length ? cloudEdition.specialFeatures : localEdition.specialFeatures,
        externalSource: cloudEdition.externalSource || localEdition.externalSource,
        externalEditionId: cloudEdition.externalEditionId || localEdition.externalEditionId,
      }
    : cloudEdition ?? localEdition;

  const cloudSummary = cloudBook.work.publisherSummary?.trim();
  const localSummary = localBook.work.publisherSummary?.trim();
  const cloudVisibleSummary = cloudBook.work.summary?.trim();
  const localVisibleSummary = localBook.work.summary?.trim();
  const cloudSummaryMissing = !cloudVisibleSummary || cloudVisibleSummary.toLowerCase() === 'summary unavailable.';

  return {
    ...cloudBook,
    work: {
      ...cloudBook.work,
      subtitle: cloudBook.work.subtitle || localBook.work.subtitle,
      summary: cloudSummaryMissing ? (cloudSummary || localSummary || localVisibleSummary || cloudBook.work.summary) : cloudBook.work.summary,
      publisherSummary: cloudSummary || localSummary || undefined,
      genres: cloudBook.work.genres?.length ? cloudBook.work.genres : localBook.work.genres,
      publicationYear: cloudBook.work.publicationYear || localBook.work.publicationYear,
      originalLanguage: cloudBook.work.originalLanguage || localBook.work.originalLanguage,
      externalWorkId: cloudBook.work.externalWorkId || localBook.work.externalWorkId,
    },
    editions: mergedEdition
      ? cloudBook.editions.map((edition) => edition.id === cloudBook.activeEditionId ? mergedEdition : edition)
      : cloudBook.editions,
    importMetadataVerified: cloudBook.importMetadataVerified === true || localBook.importMetadataVerified === true,
    importMetadataReviewNeeded: cloudBook.importMetadataReviewNeeded ?? localBook.importMetadataReviewNeeded,
    sourceOfImport: cloudBook.sourceOfImport || localBook.sourceOfImport,
  };
}

function protectRicherLocalBookMetadata(
  localBooks: UserBookRecord[],
  cloudBooks: UserBookRecord[],
  mutations: Record<string, RecordMutation<UserBookRecord>>,
) {
  const cloudById = new Map(cloudBooks.map((book) => [book.id, book]));
  const now = new Date().toISOString();

  localBooks.forEach((localBook) => {
    if (mutations[localBook.id]) return;
    const cloudBook = cloudById.get(localBook.id);
    if (!cloudBook) return;
    if (metadataRichness(localBook) <= metadataRichness(cloudBook)) return;

    const merged = mergeRicherLocalMetadata(localBook, cloudBook);
    if (fingerprint(merged) === fingerprint(cloudBook)) return;
    mutations[localBook.id] = { operation: 'upsert', data: merged, clientUpdatedAt: now };
  });
}

function reconcileHydrationChanges<T extends { id: string }>(
  localItems: T[],
  cloudItems: T[],
  baseline: Record<string, string>,
  mutations: Record<string, RecordMutation<T>>,
  shouldPreferCloud?: (local: T, cloud: T) => boolean,
) {
  const localById = new Map(localItems.map((item) => [item.id, item]));
  const cloudById = new Map(cloudItems.map((item) => [item.id, item]));
  const now = new Date().toISOString();

  Object.entries(mutations).forEach(([id, mutation]) => {
    if (mutation.operation !== 'upsert' || !mutation.data) return;
    const cloud = cloudById.get(id);
    if (cloud && shouldPreferCloud?.(mutation.data, cloud)) delete mutations[id];
  });

  localItems.forEach((item) => {
    if (mutations[item.id]) return;
    const cloud = cloudById.get(item.id);
    const baselineFingerprint = baseline[item.id];

    if (!cloud) {
      if (shouldPromoteLocalRecordMissingFromCloud({
        hasCloudRecord: false,
        baselineFingerprint,
        hasPendingMutation: false,
      })) mutations[item.id] = { operation: 'upsert', data: item, clientUpdatedAt: now };
      return;
    }

    if (shouldPreferCloud?.(item, cloud)) return;

    const cloudFingerprint = fingerprint(cloud);
    const localFingerprint = fingerprint(item);
    if (baselineFingerprint !== undefined
      && cloudFingerprint === baselineFingerprint
      && localFingerprint !== baselineFingerprint) {
      mutations[item.id] = { operation: 'upsert', data: item, clientUpdatedAt: now };
    }
  });

  Object.entries(baseline).forEach(([id, baselineFingerprint]) => {
    if (mutations[id] || localById.has(id)) return;
    const cloud = cloudById.get(id);
    if (!cloud) return;
    if (fingerprint(cloud) === baselineFingerprint) {
      mutations[id] = { operation: 'delete', clientUpdatedAt: now };
    }
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

function removeNoOpMutations<T>(mutations: Record<string, RecordMutation<T>>, baseline: Record<string, string>) {
  Object.entries(mutations).forEach(([id, mutation]) => {
    if (mutation.operation === 'delete') {
      if (baseline[id] === undefined) delete mutations[id];
      return;
    }
    if (mutation.data !== undefined && baseline[id] === fingerprint(mutation.data)) delete mutations[id];
  });
}

export const CloudPersistenceBridge: React.FC = () => {
  const sync = useAccountSync();
  const hydrated = useRef(false);
  const bookFingerprints = useRef(new Map<string, string>());
  const sessionFingerprints = useRef(new Map<string, string>());
  const profileFingerprint = useRef('');

  useEffect(() => {
    hydrated.current = false;
    bookFingerprints.current.clear();
    sessionFingerprints.current.clear();
    profileFingerprint.current = '';
    if (!sync.user || !db) return undefined;

    const uid = sync.user.uid;
    let disposed = false;
    let flushTimer: number | undefined;
    let flushInFlight: Promise<void> | undefined;
    let flushRequested = false;
    const unsubscribers: Array<() => void> = [];

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
      for (let index = 0; index < entries.length; index += INITIAL_UPLOAD_BATCH_SIZE) {
        if (disposed) return;
        const batch = entries.slice(index, index + INITIAL_UPLOAD_BATCH_SIZE);
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
        if (checkpointEntries.length >= CHECKPOINT_BATCH_SIZE || index + INITIAL_UPLOAD_BATCH_SIZE >= entries.length) {
          checkpointRecordBatch(kind, checkpointEntries);
          checkpointEntries = [];
          // Give the browser a chance to collect temporary objects and paint the UI
          // during extremely large uploads instead of monopolizing the main thread.
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      }
    };

    const performFlushPending = async () => {
      if (!navigator.onLine) return;

      const pending = readPending(uid);
      const baseline = readBaseline(uid);
      removeNoOpMutations(pending.books, baseline.books);
      removeNoOpMutations(pending.sessions, baseline.sessions);
      if (pending.profile && baseline.profile === stable(pending.profile.data)) delete pending.profile;
      writePending(uid, pending);

      const bookEntries = Object.entries(pending.books);
      const sessionEntries = Object.entries(pending.sessions);

      await uploadRecordEntries<UserBookRecord>('books', bookEntries);
      await uploadRecordEntries<ReadingSession>('sessions', sessionEntries);

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
          const profileValue = stable(preparedProfile);
          latestBaseline.profile = profileValue;
          profileFingerprint.current = profileValue;
          localStorage.setItem(PROFILE_KEY, profileValue);
          delete latestPending.profile;
          writeBaseline(uid, latestBaseline);
          writePending(uid, latestPending);
          notifyCloudDataUpdated([PROFILE_KEY]);
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
      })().finally(() => {
        flushInFlight = undefined;
      });
      return flushInFlight;
    };

    const captureCurrentChanges = (keys?: CloudSyncedStorageKey[]) => {
      if (!hydrated.current || disposed || localStorage.getItem(clearIntentKey(uid)) === '1') return;
      const changedKeys = keys ? new Set(keys) : undefined;
      const pending = readPending(uid);
      const baseline = readBaseline(uid);

      if (!changedKeys || changedKeys.has(BOOKS_KEY)) {
        captureWorkingChanges(safeParse<UserBookRecord[]>(BOOKS_KEY, []), bookFingerprints, pending.books);
        removeNoOpMutations(pending.books, baseline.books);
      }
      if (!changedKeys || changedKeys.has(SESSIONS_KEY)) {
        captureWorkingChanges(safeParse<ReadingSession[]>(SESSIONS_KEY, []), sessionFingerprints, pending.sessions);
        removeNoOpMutations(pending.sessions, baseline.sessions);
      }
      if (!changedKeys || changedKeys.has(PROFILE_KEY)) {
        const profile = safeParse<ReaderProfile>(PROFILE_KEY, {});
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
      if (disposed) return;
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(() => {
        flushTimer = undefined;
        void flushPending().catch(() => undefined);
      }, SYNC_FLUSH_DEBOUNCE_MS);
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

      if (sameAccount && !intentionalClear && bookSnapshot && sessionSnapshot) {
        protectRicherLocalBookMetadata(localBooks, cloudBooks, pending.books);
        reconcileHydrationChanges(
          localBooks,
          cloudBooks,
          baseline.books,
          pending.books,
          (localBook, cloudBook) => cloudBook.importMetadataVerified === true && localBook.importMetadataVerified !== true,
        );
        reconcileHydrationChanges(localSessions, cloudSessions, baseline.sessions, pending.sessions);
      }

      const nextBaseline: SyncBaseline = {
        books: Object.fromEntries(cloudBooks.map((book) => [book.id, fingerprint(book)])),
        sessions: Object.fromEntries(cloudSessions.map((session) => [session.id, fingerprint(session)])),
        profile: baseline.profile,
      };

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
        name: 'books' | 'sessions', storageKey: CloudSyncedStorageKey,
        fingerprints: React.MutableRefObject<Map<string, string>>,
        pendingSelector: (state: PendingSyncState) => Record<string, RecordMutation<T>>,
        baselineSelector: (state: SyncBaseline) => Record<string, string>,
      ) => onSnapshot(collection(db!, 'users', uid, name), (snapshot) => {
        if (!hydrated.current) return;
        const pendingState = readPending(uid);
        const currentPending = pendingSelector(pendingState);
        const currentBaseline = readBaseline(uid);
        const baselineCollection = baselineSelector(currentBaseline);
        let current = safeParse<T[]>(storageKey, []);
        let changed = false;
        let baselineChanged = false;
        let pendingChanged = false;
        const currentIndex = new Map(current.map((item, index) => [item.id, index]));

        snapshot.docChanges().forEach((change) => {
          const id = change.doc.id;
          const envelope = change.type === 'removed' ? undefined : change.doc.data() as CloudRecord<T>;
          const localMutation = currentPending[id];

          if (localMutation) {
            const cloudClientUpdatedAt = envelope?.clientUpdatedAt;
            const cloudIsNewer = Boolean(cloudClientUpdatedAt && cloudClientUpdatedAt > localMutation.clientUpdatedAt);
            if (!cloudIsNewer) return;
            delete currentPending[id];
            pendingChanged = true;
          }

          if (change.type === 'removed') {
            const index = currentIndex.get(id);
            if (index !== undefined) {
              current[index] = undefined as unknown as T;
              currentIndex.delete(id);
              changed = true;
            }
            fingerprints.current.delete(id);
            if (baselineCollection[id] !== undefined) { delete baselineCollection[id]; baselineChanged = true; }
            return;
          }

          const record = envelope?.data;
          if (!record) return;
          const recordFingerprint = fingerprint(record);
          const index = currentIndex.get(record.id);
          if (index !== undefined) {
            if (fingerprints.current.get(record.id) !== recordFingerprint) {
              current[index] = record;
              changed = true;
            }
          } else {
            currentIndex.set(record.id, current.length);
            current.push(record);
            changed = true;
          }
          fingerprints.current.set(record.id, recordFingerprint);
          if (baselineCollection[record.id] !== recordFingerprint) { baselineCollection[record.id] = recordFingerprint; baselineChanged = true; }
        });

        if (changed) current = current.filter(Boolean);
        if (pendingChanged) writePending(uid, pendingState);
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
          const profileValue = stable(cloudValue);
          const currentBaseline = readBaseline(uid);
          if (currentBaseline.profile !== profileValue) { currentBaseline.profile = profileValue; writeBaseline(uid, currentBaseline); }
          if (profileValue === profileFingerprint.current) return;
          profileFingerprint.current = profileValue;
          localStorage.setItem(PROFILE_KEY, profileValue);
          notifyCloudDataUpdated([PROFILE_KEY]);
        }, () => undefined),
      );

      hydrated.current = true;
      localStorage.setItem(BRIDGE_VERSION_KEY, BRIDGE_VERSION);
      notifyCloudDataUpdated([BOOKS_KEY, SESSIONS_KEY, PROFILE_KEY]);
      try { await flushPending(); } catch { /* Durable queue remains for the next open/reconnect. */ }
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
      if (navigator.onLine) void flushPending().catch(() => undefined);
    });

    const preserve = () => captureCurrentChanges();
    const resumePendingSync = () => {
      if (!hydrated.current || disposed || !navigator.onLine) return;
      captureCurrentChanges();
      void flushPending().catch(() => undefined);
    };
    const handleVisibilityChange = () => {
      preserve();
      if (document.visibilityState === 'visible') resumePendingSync();
    };
    const syncNow = (event: Event) => {
      if (!hydrated.current || disposed) return;
      const detail = (event as CustomEvent<LocalDataChangedDetail>).detail;
      captureCurrentChanges(detail?.keys);
      scheduleFlush();
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

    window.addEventListener('pagehide', preserve);
    window.addEventListener('online', resumePendingSync);
    window.addEventListener('focus', resumePendingSync);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, syncNow);
    window.addEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, flushBeforeSignOut);
    return () => {
      preserve();
      disposed = true;
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      window.removeEventListener('pagehide', preserve);
      window.removeEventListener('online', resumePendingSync);
      window.removeEventListener('focus', resumePendingSync);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, syncNow);
      window.removeEventListener(INKBOUND_BEFORE_SIGN_OUT_EVENT, flushBeforeSignOut);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [sync.user?.uid]);

  return null;
};
