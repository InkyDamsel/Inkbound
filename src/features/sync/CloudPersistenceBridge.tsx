import React, { useEffect, useRef } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import type { ReadingSession, UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db, storage } from '../../lib/firebase';

const BOOKS_KEY = 'inkbound_books';
const SESSIONS_KEY = 'inkbound_sessions';
const PROFILE_KEY = 'inkbound_reader_profile';
const BRIDGE_VERSION_KEY = 'inkbound_cloud_bridge_version';
const BRIDGE_VERSION = '1';

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

const mergeById = <T extends { id: string }>(local: T[], cloud: T[]): T[] => {
  const merged = new Map(local.map((item) => [item.id, item]));
  cloud.forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values());
};

const isDataImage = (value?: string) => Boolean(value?.startsWith('data:image/'));

async function uploadProfileImage(
  uid: string,
  kind: 'avatar' | 'banner',
  value?: string,
): Promise<string | undefined> {
  if (!value || !isDataImage(value) || !storage) return value;
  const blob = await fetch(value).then((response) => response.blob());
  const extension = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'webp';
  const imageRef = ref(storage, `users/${uid}/profile/${kind}.${extension}`);
  await uploadBytes(imageRef, blob, { contentType: blob.type });
  return getDownloadURL(imageRef);
}

async function prepareCloudProfile(uid: string, profile: ReaderProfile): Promise<ReaderProfile> {
  const [avatarImage, bannerImage] = await Promise.all([
    uploadProfileImage(uid, 'avatar', profile.avatarImage),
    uploadProfileImage(uid, 'banner', profile.bannerImage),
  ]);
  return { ...profile, avatarImage, bannerImage };
}

export const CloudPersistenceBridge: React.FC = () => {
  const sync = useAccountSync();
  const hydrated = useRef(false);
  const applyingCloud = useRef(false);
  const booksFingerprint = useRef('');
  const sessionsFingerprint = useRef('');
  const profileFingerprint = useRef('');
  const reloadQueued = useRef(false);

  useEffect(() => {
    hydrated.current = false;
    applyingCloud.current = false;
    booksFingerprint.current = '';
    sessionsFingerprint.current = '';
    profileFingerprint.current = '';
    reloadQueued.current = false;

    if (!sync.user || !db) return undefined;
    const uid = sync.user.uid;
    let disposed = false;
    const unsubscribers: Array<() => void> = [];

    const queueReload = () => {
      if (reloadQueued.current) return;
      reloadQueued.current = true;
      window.setTimeout(() => window.location.reload(), 250);
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
      const booksChanged = stable(mergedBooks) !== stable(localBooks);
      const sessionsChanged = stable(mergedSessions) !== stable(localSessions);

      applyingCloud.current = true;
      localStorage.setItem(BOOKS_KEY, stable(mergedBooks));
      localStorage.setItem(SESSIONS_KEY, stable(mergedSessions));
      booksFingerprint.current = stable(mergedBooks);
      sessionsFingerprint.current = stable(mergedSessions);

      const cloudBookIds = new Set(cloudBooks.map((book) => book.id));
      const cloudSessionIds = new Set(cloudSessions.map((session) => session.id));
      await Promise.all([
        ...localBooks
          .filter((book) => !cloudBookIds.has(book.id))
          .map((book) => setDoc(
            doc(db!, 'users', uid, 'books', book.id),
            { data: book, updatedAt: serverTimestamp(), clientUpdatedAt: new Date().toISOString() },
            { merge: true },
          )),
        ...localSessions
          .filter((session) => !cloudSessionIds.has(session.id))
          .map((session) => setDoc(
            doc(db!, 'users', uid, 'sessions', session.id),
            { data: session, updatedAt: serverTimestamp(), clientUpdatedAt: new Date().toISOString() },
            { merge: true },
          )),
      ]);

      const profileRef = doc(db!, 'users', uid, 'profile', 'current');
      const unsubscribeProfile = onSnapshot(profileRef, async (snapshot) => {
        if (!hydrated.current) return;
        if (!snapshot.exists()) return;
        const cloudProfile = (snapshot.data() as CloudRecord<ReaderProfile>).data;
        if (!cloudProfile) return;
        const fingerprint = stable(cloudProfile);
        if (fingerprint === profileFingerprint.current) return;
        applyingCloud.current = true;
        profileFingerprint.current = fingerprint;
        localStorage.setItem(PROFILE_KEY, fingerprint);
        queueReload();
      });
      unsubscribers.push(unsubscribeProfile);

      const cloudProfileSnapshot = await import('firebase/firestore').then(({ getDoc }) => getDoc(profileRef));
      if (cloudProfileSnapshot.exists()) {
        const cloudProfile = (cloudProfileSnapshot.data() as CloudRecord<ReaderProfile>).data;
        if (cloudProfile) {
          profileFingerprint.current = stable(cloudProfile);
          if (stable(localProfile) !== profileFingerprint.current) {
            localStorage.setItem(PROFILE_KEY, profileFingerprint.current);
          }
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
      }

      const subscribeCollection = <T extends { id: string }>(
        name: 'books' | 'sessions',
        storageKey: string,
        fingerprintRef: React.MutableRefObject<string>,
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
          } else if (record) {
            const index = current.findIndex((item) => item.id === record.id);
            if (index >= 0) current[index] = record;
            else current.push(record);
            changed = true;
          }
        });
        if (!changed) return;
        const fingerprint = stable(current);
        if (fingerprint === fingerprintRef.current) return;
        applyingCloud.current = true;
        fingerprintRef.current = fingerprint;
        localStorage.setItem(storageKey, fingerprint);
        queueReload();
      });

      unsubscribers.push(
        subscribeCollection<UserBookRecord>('books', BOOKS_KEY, booksFingerprint),
        subscribeCollection<ReadingSession>('sessions', SESSIONS_KEY, sessionsFingerprint),
      );

      hydrated.current = true;
      applyingCloud.current = false;
      localStorage.setItem(BRIDGE_VERSION_KEY, BRIDGE_VERSION);
      if (booksChanged || sessionsChanged || stable(localProfile) !== profileFingerprint.current) queueReload();
    };

    void initialize();

    const poll = window.setInterval(async () => {
      if (!hydrated.current || applyingCloud.current || disposed) {
        applyingCloud.current = false;
        return;
      }

      const localBooks = safeParse<UserBookRecord[]>(BOOKS_KEY, []);
      const localSessions = safeParse<ReadingSession[]>(SESSIONS_KEY, []);
      const localProfile = safeParse<ReaderProfile>(PROFILE_KEY, {});
      const nextBooksFingerprint = stable(localBooks);
      const nextSessionsFingerprint = stable(localSessions);
      const nextProfileFingerprint = stable(localProfile);

      if (nextBooksFingerprint !== booksFingerprint.current) {
        const previous = safeParse<UserBookRecord[]>(`${BOOKS_KEY}_cloud_previous`, []);
        const previousIds = new Set(previous.map((book) => book.id));
        const nextIds = new Set(localBooks.map((book) => book.id));
        await Promise.all([
          ...localBooks.map((book) => setDoc(
            doc(db!, 'users', uid, 'books', book.id),
            { data: book, updatedAt: serverTimestamp(), clientUpdatedAt: new Date().toISOString() },
            { merge: true },
          )),
          ...Array.from(previousIds)
            .filter((id) => !nextIds.has(id))
            .map((id) => deleteDoc(doc(db!, 'users', uid, 'books', id))),
        ]);
        booksFingerprint.current = nextBooksFingerprint;
        localStorage.setItem(`${BOOKS_KEY}_cloud_previous`, nextBooksFingerprint);
      }

      if (nextSessionsFingerprint !== sessionsFingerprint.current) {
        const previous = safeParse<ReadingSession[]>(`${SESSIONS_KEY}_cloud_previous`, []);
        const previousIds = new Set(previous.map((session) => session.id));
        const nextIds = new Set(localSessions.map((session) => session.id));
        await Promise.all([
          ...localSessions.map((session) => setDoc(
            doc(db!, 'users', uid, 'sessions', session.id),
            { data: session, updatedAt: serverTimestamp(), clientUpdatedAt: new Date().toISOString() },
            { merge: true },
          )),
          ...Array.from(previousIds)
            .filter((id) => !nextIds.has(id))
            .map((id) => deleteDoc(doc(db!, 'users', uid, 'sessions', id))),
        ]);
        sessionsFingerprint.current = nextSessionsFingerprint;
        localStorage.setItem(`${SESSIONS_KEY}_cloud_previous`, nextSessionsFingerprint);
      }

      if (nextProfileFingerprint !== profileFingerprint.current && Object.keys(localProfile).length > 0) {
        const prepared = await prepareCloudProfile(uid, localProfile);
        profileFingerprint.current = stable(prepared);
        localStorage.setItem(PROFILE_KEY, profileFingerprint.current);
        await setDoc(doc(db!, 'users', uid, 'profile', 'current'), {
          data: prepared,
          updatedAt: serverTimestamp(),
          clientUpdatedAt: new Date().toISOString(),
        }, { merge: true });
      }
    }, 1200);

    return () => {
      disposed = true;
      window.clearInterval(poll);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [sync.user?.uid]);

  return null;
};
