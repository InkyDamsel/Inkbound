import { Dispatch, SetStateAction, useEffect, useRef } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { ReadingSession, UserBookRecord } from '../../types';
import { db } from '../../lib/firebase';

interface CloudRecord<T> {
  data: T;
  updatedAt?: unknown;
  clientUpdatedAt?: string;
}

interface UseCloudLibrarySyncOptions {
  user: User | null;
  books: UserBookRecord[];
  setBooks: Dispatch<SetStateAction<UserBookRecord[]>>;
  sessions: ReadingSession[];
  setSessions: Dispatch<SetStateAction<ReadingSession[]>>;
}

const serialize = (value: unknown) => JSON.stringify(value);

function mergeById<T extends { id: string }>(local: T[], cloud: T[]): T[] {
  const merged = new Map(local.map((item) => [item.id, item]));
  cloud.forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values());
}

export function useCloudLibrarySync({
  user,
  books,
  setBooks,
  sessions,
  setSessions,
}: UseCloudLibrarySyncOptions) {
  const booksHydrated = useRef(false);
  const sessionsHydrated = useRef(false);
  const previousBooks = useRef(new Map<string, string>());
  const previousSessions = useRef(new Map<string, string>());

  useEffect(() => {
    booksHydrated.current = false;
    sessionsHydrated.current = false;
    previousBooks.current.clear();
    previousSessions.current.clear();

    if (!user || !db) return undefined;

    const booksCollection = collection(db, 'users', user.uid, 'books');
    const sessionsCollection = collection(db, 'users', user.uid, 'sessions');

    const unsubscribeBooks = onSnapshot(booksCollection, (snapshot) => {
      const cloudBooks = snapshot.docs
        .map((document) => (document.data() as CloudRecord<UserBookRecord>).data)
        .filter(Boolean);

      if (!booksHydrated.current) {
        setBooks((current) => {
          const merged = mergeById(current, cloudBooks);
          previousBooks.current = new Map(merged.map((book) => [book.id, serialize(book)]));
          return merged;
        });
        booksHydrated.current = true;
        return;
      }

      snapshot.docChanges().forEach((change) => {
        const cloudBook = (change.doc.data() as CloudRecord<UserBookRecord>).data;
        if (change.type === 'removed') {
          previousBooks.current.delete(change.doc.id);
          setBooks((current) => current.filter((book) => book.id !== change.doc.id));
          return;
        }
        if (!cloudBook) return;
        previousBooks.current.set(cloudBook.id, serialize(cloudBook));
        setBooks((current) => {
          const exists = current.some((book) => book.id === cloudBook.id);
          return exists
            ? current.map((book) => (book.id === cloudBook.id ? cloudBook : book))
            : [...current, cloudBook];
        });
      });
    });

    const unsubscribeSessions = onSnapshot(sessionsCollection, (snapshot) => {
      const cloudSessions = snapshot.docs
        .map((document) => (document.data() as CloudRecord<ReadingSession>).data)
        .filter(Boolean);

      if (!sessionsHydrated.current) {
        setSessions((current) => {
          const merged = mergeById(current, cloudSessions);
          previousSessions.current = new Map(merged.map((session) => [session.id, serialize(session)]));
          return merged;
        });
        sessionsHydrated.current = true;
        return;
      }

      snapshot.docChanges().forEach((change) => {
        const cloudSession = (change.doc.data() as CloudRecord<ReadingSession>).data;
        if (change.type === 'removed') {
          previousSessions.current.delete(change.doc.id);
          setSessions((current) => current.filter((session) => session.id !== change.doc.id));
          return;
        }
        if (!cloudSession) return;
        previousSessions.current.set(cloudSession.id, serialize(cloudSession));
        setSessions((current) => {
          const exists = current.some((session) => session.id === cloudSession.id);
          return exists
            ? current.map((session) => (session.id === cloudSession.id ? cloudSession : session))
            : [...current, cloudSession];
        });
      });
    });

    return () => {
      unsubscribeBooks();
      unsubscribeSessions();
    };
  }, [setBooks, setSessions, user?.uid]);

  useEffect(() => {
    if (!user || !db || !booksHydrated.current) return undefined;

    const timeout = window.setTimeout(() => {
      const next = new Map(books.map((book) => [book.id, serialize(book)]));

      books.forEach((book) => {
        if (previousBooks.current.get(book.id) === next.get(book.id)) return;
        void setDoc(
          doc(db!, 'users', user.uid, 'books', book.id),
          { data: book, updatedAt: serverTimestamp(), clientUpdatedAt: new Date().toISOString() },
          { merge: true },
        );
      });

      previousBooks.current.forEach((_, id) => {
        if (!next.has(id)) void deleteDoc(doc(db!, 'users', user.uid, 'books', id));
      });

      previousBooks.current = next;
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [books, user?.uid]);

  useEffect(() => {
    if (!user || !db || !sessionsHydrated.current) return undefined;

    const timeout = window.setTimeout(() => {
      const next = new Map(sessions.map((session) => [session.id, serialize(session)]));

      sessions.forEach((session) => {
        if (previousSessions.current.get(session.id) === next.get(session.id)) return;
        void setDoc(
          doc(db!, 'users', user.uid, 'sessions', session.id),
          { data: session, updatedAt: serverTimestamp(), clientUpdatedAt: new Date().toISOString() },
          { merge: true },
        );
      });

      previousSessions.current.forEach((_, id) => {
        if (!next.has(id)) void deleteDoc(doc(db!, 'users', user.uid, 'sessions', id));
      });

      previousSessions.current = next;
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [sessions, user?.uid]);
}
