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
const BRIDGE_VERSION = '2';
const LOCAL_CHANGE_POLL_MS = 2000;
const INITIAL_UPLOAD_BATCH_SIZE = 100;

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

const mergeById = <T extends { id: string }>(local: T[], cloud: T[]): T[] => {
  const merged = new Map(local.map((item) => [item.id, item]));
  cloud.forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values());
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

async function optimizeProfileImage(
  value: string,
  kind: 'avatar' | 'banner',
): Promise<Blob> {
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

    const writeCollectionChanges = async <T extends { id: string }>(
      name: 'books' | 'sessions',
      items: T[],
      fingerprints: React.MutableRefObject<Map<string, string>>,
    ) => {
      const nextFingerprints = toFingerprintMap(items);
      const changed = items.filter(
        (item) => fingerprints.current.get(item.id) !== nextFingerprints.get(item.id),
      );
      const deletedIds = Array.from(fingerprints.current.keys()).filter(
        (id) => !nextFingerprints.has(id),
      );

      if (changed.length === 0 && deletedIds.length === 0) return;

      await Promise.all([
        ...changed.map((item) =>
          setDoc(
            doc(db!, 'users', uid, name, item.id),
            {
              data: item,
              updatedAt: serverTimestamp(),
              clientUpdatedAt: new Date().toISOString(),
            },
            { merge: true },
          ),
        ),
        ...deletedIds.map((id) => deleteDoc(doc(db!, 'users', uid, name, id))),
      ]);
      fingerprints.current = nextFingerprints;
    };

    const initialize = async () => {
      const localBooks = safeParse<UserBookRecord[]>(BOOKS_KEY, []);
      const localSessions = safeParse<ReadingSession[]>(SESSIONS_KEY, []);
      const localProfile = safeParse<ReaderProfile>(PROFILE_KEY, {});

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
      const mergedBooks = mergeById(localBooks, cloudBooks);
      const mergedSessions = mergeById(localSessions, cloudSessions);

      localStorage.setItem(BOOKS_KEY, stable(mergedBooks));
      localStorage.setItem(SESSIONS_KEY, stable(mergedSessions));
      bookFingerprints.current = toFingerprintMap(mergedBooks);
      sessionFingerprints.current = toFingerprintMap(mergedSessions);

      const cloudBookIds = new Set(cloudBooks.map((book) => book.id));
      const cloudSessionIds = new Set(cloudSessions.map((session) => session.id));
      const migrationTasks: Array<() => Promise<unknown>> = [
        ...localBooks
          .filter((book) => !cloudBookIds.has(book.id))
          .map((book) => () =>
            setDoc(
              doc(db!, 'users', uid, 'books', book.id),
              {
                data: book,
                updatedAt: serverTimestamp(),
                clientUpdatedAt: new Date().toISOString(),
              },
              { merge: true },
            ),
          ),
        ...localSessions
          .filter((session) => !cloudSessionIds.has(session.id))
          .map((session) => () =>
            setDoc(
              doc(db!, 'users', uid, 'sessions', session.id),
              {
                data: session,
                updatedAt: serverTimestamp(),
                clientUpdatedAt: new Date().toISOString(),
              },
              { merge: true },
            ),
          ),
      ];
      await runInBatches(migrationTasks);

      const profileRef = doc(db!, 'users', uid, 'profile', 'current');
      const cloudProfileSnapshot = await getDoc(profileRef);
      if (cloudProfileSnapshot.exists()) {
        const cloudProfile = (cloudProfileSnapshot.data() as CloudRecord<ReaderProfile>).data;
        if (cloudProfile) {
          profileFingerprint.current = stable(cloudProfile);
          localStorage.setItem(PROFILE_KEY, profileFingerprint.current);
        }
      } else if (Object.keys(localProfile).length > 0) {
        const prepared = await prepareCloudProfile(uid, localProfile);
        profileFingerprint.current = stable(prepared);
        localStorage.setItem(PROFILE_KEY, profileFingerprint.current);
        await setDoc(profileRef, {
          data: prepared,
          updatedAt: serverTimestamp(),
          clientUpdatedAt: new Date().toISOString(),
        });
      } else {
        profileFingerprint.current = stable(localProfile);
      }

      const subscribeCollection = <T extends { id: string }>(
        name: 'books' | 'sessions',
        storageKey: 'inkbound_books' | 'inkbound_sessions',
        fingerprints: React.MutableRefObject<Map<string, string>>,
      ) => onSnapshot(collection(db!, 'users', uid, name), (snapshot) => {
        if (!hydrated.current) return;
        let current = safeParse<T[]>(storageKey, []);
        let changed = false;

        snapshot.docChanges().forEach((change) => {
          const record = (change.doc.data() as CloudRecord<T>).data;
          if (change.type === 'removed') {
            const next = current.filter((item) => item.id !== change.doc.id);
            changed = changed || next.length !== current.length;
            current = next;
            fingerprints.current.delete(change.doc.id);
            return;
          }
          if (!record) return;
          const serialized = stable(record);
          if (fingerprints.current.get(record.id) === serialized) return;
          const index = current.findIndex((item) => item.id === record.id);
          if (index >= 0) current[index] = record;
          else current.push(record);
          fingerprints.current.set(record.id, serialized);
          changed = true;
        });

        if (!changed) return;
        localStorage.setItem(storageKey, stable(current));
        notifyCloudDataUpdated([storageKey]);
      });

      const unsubscribeProfile = onSnapshot(profileRef, (snapshot) => {
        if (!hydrated.current || !snapshot.exists()) return;
        const cloudProfile = (snapshot.data() as CloudRecord<ReaderProfile>).data;
        if (!cloudProfile) return;
        const fingerprint = stable(cloudProfile);
        if (fingerprint === profileFingerprint.current) return;
        profileFingerprint.current = fingerprint;
        localStorage.setItem(PROFILE_KEY, fingerprint);
        notifyCloudDataUpdated([PROFILE_KEY]);
      });

      unsubscribers.push(
        subscribeCollection<UserBookRecord>('books', BOOKS_KEY, bookFingerprints),
        subscribeCollection<ReadingSession>('sessions', SESSIONS_KEY, sessionFingerprints),
        unsubscribeProfile,
      );

      hydrated.current = true;
      localStorage.setItem(BRIDGE_VERSION_KEY, BRIDGE_VERSION);
      notifyCloudDataUpdated([BOOKS_KEY, SESSIONS_KEY, PROFILE_KEY]);
    };

    void initialize();

    const poll = window.setInterval(async () => {
      if (!hydrated.current || disposed || pollRunning.current) return;
      pollRunning.current = true;
      try {
        const localBooks = safeParse<UserBookRecord[]>(BOOKS_KEY, []);
        const localSessions = safeParse<ReadingSession[]>(SESSIONS_KEY, []);
        const localProfile = safeParse<ReaderProfile>(PROFILE_KEY, {});

        await writeCollectionChanges('books', localBooks, bookFingerprints);
        await writeCollectionChanges('sessions', localSessions, sessionFingerprints);

        const nextProfileFingerprint = stable(localProfile);
        if (
          Object.keys(localProfile).length > 0 &&
          nextProfileFingerprint !== profileFingerprint.current
        ) {
          const prepared = await prepareCloudProfile(uid, localProfile);
          profileFingerprint.current = stable(prepared);
          localStorage.setItem(PROFILE_KEY, profileFingerprint.current);
          await setDoc(
            doc(db!, 'users', uid, 'profile', 'current'),
            {
              data: prepared,
              updatedAt: serverTimestamp(),
              clientUpdatedAt: new Date().toISOString(),
            },
            { merge: true },
          );
          notifyCloudDataUpdated([PROFILE_KEY]);
        }
      } finally {
        pollRunning.current = false;
      }
    }, LOCAL_CHANGE_POLL_MS);

    return () => {
      disposed = true;
      window.clearInterval(poll);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [sync.user?.uid]);

  return null;
};
