import React, { useEffect, useRef } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { Edition, UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import { SYNC_STORAGE_KEYS } from './storageKeys';
import {
  INKBOUND_CLOUD_DATA_EVENT,
  INKBOUND_LOCAL_DATA_CHANGED_EVENT,
  type CloudDataUpdatedDetail,
  type LocalDataChangedDetail,
} from './cloudSyncEvents';

const BOOKS_KEY = SYNC_STORAGE_KEYS.books;
const LEDGER_COLLECTION = 'protectedBookDetails';

interface ProtectedBookDetails {
  bookId: string;
  work: {
    title: string;
    subtitle?: string;
    author: string;
    summary: string;
    publisherSummary?: string;
    personalSummary?: string;
    seriesName?: string;
    seriesOrder?: number;
    seriesLabel?: string;
    seriesSource?: 'manual' | 'metadata';
    genres: string[];
    tropes?: string[];
    contentWarnings?: string[];
    publicationYear: number;
    originalLanguage?: string;
    externalWorkId?: string;
  };
  reader: {
    review?: string;
    personalNotes?: string;
    favoriteQuotes?: UserBookRecord['favoriteQuotes'];
    privateTags: string[];
    collections: string[];
    whyIAddedThis?: string;
  };
  editionId?: string;
  edition?: Omit<Edition, 'coverUrl'>;
}

function readBooks(): UserBookRecord[] {
  try {
    const raw = getRuntimeStorage().getItem(BOOKS_KEY);
    return raw ? JSON.parse(raw) as UserBookRecord[] : [];
  } catch {
    return [];
  }
}

function omitUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function detailsFor(book: UserBookRecord): ProtectedBookDetails {
  const activeEdition = book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];
  const edition = activeEdition
    ? (({ coverUrl: _coverUrl, ...rest }) => rest)(activeEdition)
    : undefined;

  return omitUndefined({
    bookId: book.id,
    work: {
      title: book.work.title,
      subtitle: book.work.subtitle,
      author: book.work.author,
      summary: book.work.summary,
      publisherSummary: book.work.publisherSummary,
      personalSummary: book.work.personalSummary,
      seriesName: book.work.seriesName,
      seriesOrder: book.work.seriesOrder,
      seriesLabel: book.work.seriesLabel,
      seriesSource: book.work.seriesSource,
      genres: book.work.genres,
      tropes: book.work.tropes,
      contentWarnings: book.work.contentWarnings,
      publicationYear: book.work.publicationYear,
      originalLanguage: book.work.originalLanguage,
      externalWorkId: book.work.externalWorkId,
    },
    reader: {
      review: book.review,
      personalNotes: book.personalNotes,
      favoriteQuotes: book.favoriteQuotes,
      privateTags: book.privateTags,
      collections: book.collections,
      whyIAddedThis: book.whyIAddedThis,
    },
    editionId: activeEdition?.id,
    edition,
  });
}

function signaturesFor(books: UserBookRecord[]): Map<string, string> {
  return new Map(books.map((book) => [book.id, JSON.stringify(detailsFor(book))]));
}

/**
 * Reader-entered book details are durable data, not disposable metadata.
 *
 * This ledger intentionally starts with the current library as its baseline and
 * only writes entries after a book changes locally. A cloud hydration event
 * refreshes the baseline without writing, so an older server snapshot cannot
 * teach the safety ledger that stale data is the reader's newest edit.
 *
 * Covers are excluded because ManualCoverLedgerBridge protects those separately.
 */
export const ProtectedBookDetailsLedgerBridge: React.FC = () => {
  const { user } = useAccountSync();
  const baseline = useRef(new Map<string, string>());
  const running = useRef(false);
  const rerunRequested = useRef(false);

  useEffect(() => {
    if (!user || !db) return undefined;
    const uid = user.uid;
    baseline.current = signaturesFor(readBooks());

    const captureLocalChanges = async () => {
      if (running.current) {
        rerunRequested.current = true;
        return;
      }

      running.current = true;
      try {
        const books = readBooks();
        const currentSignatures = signaturesFor(books);

        for (const book of books) {
          const previousSignature = baseline.current.get(book.id);
          const currentSignature = currentSignatures.get(book.id);

          // A brand-new book establishes its baseline first. Once the reader or
          // local metadata tools change it, subsequent edits are protected.
          if (previousSignature === undefined || previousSignature === currentSignature) continue;

          await setDoc(doc(db, 'users', uid, LEDGER_COLLECTION, book.id), {
            ...detailsFor(book),
            clientUpdatedAt: new Date().toISOString(),
            updatedAt: serverTimestamp(),
          }, { merge: false });
        }

        baseline.current = currentSignatures;
      } catch (error) {
        console.error('Inkbound could not persist protected book details.', error);
      } finally {
        running.current = false;
        if (rerunRequested.current) {
          rerunRequested.current = false;
          void captureLocalChanges();
        }
      }
    };

    const onLocalChange = (event: Event) => {
      const detail = (event as CustomEvent<LocalDataChangedDetail>).detail;
      if (detail?.keys?.includes(BOOKS_KEY)) void captureLocalChanges();
    };

    const onCloudChange = (event: Event) => {
      const detail = (event as CustomEvent<CloudDataUpdatedDetail>).detail;
      if (!detail?.keys?.includes(BOOKS_KEY)) return;
      // Cloud-originated refreshes are canonical hydration, not a new reader edit.
      baseline.current = signaturesFor(readBooks());
    };

    window.addEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, onLocalChange);
    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, onCloudChange);
    return () => {
      window.removeEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, onLocalChange);
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, onCloudChange);
    };
  }, [user?.uid]);

  return null;
};
