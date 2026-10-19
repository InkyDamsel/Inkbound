import React, { useEffect, useRef } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc, type QuerySnapshot, type DocumentData } from 'firebase/firestore';
import type { Edition, UserBookRecord } from '../../types';
import { useAccountSync } from '../../context/AccountSyncContext';
import { db } from '../../lib/firebase';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import { replaceCanonicalLibrary } from '../library/libraryMutations';
import {
  INKBOUND_CLOUD_DATA_EVENT,
  INKBOUND_LOCAL_DATA_CHANGED_EVENT,
  type CloudDataUpdatedDetail,
  type LocalDataChangedDetail,
} from './cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from './storageKeys';

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
  reading?: {
    status: UserBookRecord['status'];
    customReadingStatusId?: string;
    dateStarted?: string;
    dateFinished?: string;
    rating?: number;
    spiceLevel?: number;
    priority: UserBookRecord['priority'];
    moods: string[];
  };
  editionId?: string;
  edition?: Omit<Edition, 'coverUrl'>;
}

function readBooks(): UserBookRecord[] {
  const raw = getRuntimeStorage().getItem(BOOKS_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Canonical library is not an array; refusing protected ledger reconciliation.');
  return parsed as UserBookRecord[];
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
    reading: {
      status: book.status,
      customReadingStatusId: book.customReadingStatusId,
      dateStarted: book.dateStarted,
      dateFinished: book.dateFinished,
      rating: book.rating,
      spiceLevel: book.spiceLevel,
      priority: book.priority,
      moods: book.moods,
    },
    editionId: activeEdition?.id,
    edition,
  });
}

function signaturesFor(books: UserBookRecord[]): Map<string, string> {
  return new Map(books.map((book) => [book.id, JSON.stringify(detailsFor(book))]));
}

function usableSummary(value: string | undefined): boolean {
  const text = value?.trim();
  return Boolean(text && !/^summary unavailable\.?$/i.test(text));
}

/**
 * The account library is canonical. This ledger is recovery evidence only:
 * never replay its older reading status, notes, tags, editions or metadata
 * over a valid current record. A missing synopsis is the one recoverable
 * field we can identify without confusing an intentional edit with a gap.
 */
function applyProtectedDetails(book: UserBookRecord, details: ProtectedBookDetails): UserBookRecord {
  const protectedWork = details.work;
  if (!protectedWork) return book;
  const usableAuthor = (value?: string) =>
    Boolean(value?.trim() && value.trim().toLowerCase() !== 'unknown author');
  const author = usableAuthor(book.work.author) || !usableAuthor(protectedWork.author)
    ? book.work.author : protectedWork.author;
  const summary = usableSummary(book.work.summary) || !usableSummary(protectedWork.summary)
    ? book.work.summary : protectedWork.summary;
  const publisherSummary = usableSummary(book.work.publisherSummary) || !usableSummary(protectedWork.publisherSummary)
    ? book.work.publisherSummary : protectedWork.publisherSummary;
  if (author === book.work.author && summary === book.work.summary && publisherSummary === book.work.publisherSummary) return book;
  return {
    ...book,
    work: { ...book.work, author, summary, publisherSummary },
  };
}

/** Reader-entered book details are durable data, not disposable metadata. */
export const ProtectedBookDetailsLedgerBridge: React.FC = () => {
  const { user } = useAccountSync();
  const baseline = useRef(new Map<string, string>());
  const running = useRef(false);
  const rerunRequested = useRef(false);

  useEffect(() => {
    if (!user || !db) return undefined;
    const uid = user.uid;
    let disposed = false;
    baseline.current = signaturesFor(readBooks());

    const restoreProtectedDetails = (snapshot: QuerySnapshot<DocumentData>) => {
      try {
        if (disposed || snapshot.empty) return;

        const protectedById = new Map(
          snapshot.docs
            .map((item) => item.data() as ProtectedBookDetails)
            .filter((item) => Boolean(item?.bookId))
            .map((item) => [item.bookId, item]),
        );
        if (!protectedById.size) return;

        const currentBooks = readBooks();
        const restoredBooks = currentBooks.map((book) => {
          const protectedDetails = protectedById.get(book.id);
          if (!protectedDetails) return book;
          // Never restore an older cloud ledger snapshot over unacknowledged
          // local edits. The local mutation must be persisted first.
          const acknowledged = baseline.current.get(book.id);
          if (acknowledged !== undefined && acknowledged !== JSON.stringify(detailsFor(book))) return book;
          return applyProtectedDetails(book, protectedDetails);
        });

        if (JSON.stringify(currentBooks) === JSON.stringify(restoredBooks)) {
          baseline.current = signaturesFor(currentBooks);
          return;
        }

        // Mark the restored state as the protected baseline before the canonical
        // write emits its local-change event, otherwise the ledger bridge can
        // mistake recovery for a fresh reader edit and loop.
        const restoredSignatures = signaturesFor(restoredBooks);
        if (replaceCanonicalLibrary(restoredBooks)) {
          baseline.current = restoredSignatures;
        } else {
          console.error('Inkbound could not commit protected book details recovery; retaining the previous baseline.');
        }
      } catch (error) {
        console.error('Inkbound could not restore protected book details.', error);
      }
    };

    const captureLocalChanges = async () => {
      if (running.current) {
        rerunRequested.current = true;
        return;
      }

      running.current = true;
      try {
        const books = readBooks();
        const currentSignatures = signaturesFor(books);

        const acknowledgedSignatures = new Map(baseline.current);
        for (const book of books) {
          const previousSignature = baseline.current.get(book.id);
          const currentSignature = currentSignatures.get(book.id);
          // A newly added book must be backed up too. Otherwise its first
          // cloud overwrite can erase reader-entered metadata before any edit
          // ever creates a protected-details document.
          if (previousSignature === currentSignature) continue;

          await setDoc(doc(db, 'users', uid, LEDGER_COLLECTION, book.id), {
            ...detailsFor(book),
            clientUpdatedAt: new Date().toISOString(),
            updatedAt: serverTimestamp(),
          }, { merge: false });
          // Advance the acknowledged baseline only after Firestore confirms the write.
          acknowledgedSignatures.set(book.id, currentSignature!);
        }

        baseline.current = acknowledgedSignatures;
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
      // The live protected-details listener below will re-apply the independently
      // persisted reader-owned state when its snapshot changes.
    };

    const unsubscribeProtectedDetails = onSnapshot(
      collection(db, 'users', uid, LEDGER_COLLECTION),
      (snapshot) => { restoreProtectedDetails(snapshot); },
      (error) => console.warn('Inkbound protected book details listener failed.', error),
    );
    window.addEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, onLocalChange);
    window.addEventListener(INKBOUND_CLOUD_DATA_EVENT, onCloudChange);
    return () => {
      disposed = true;
      unsubscribeProtectedDetails();
      window.removeEventListener(INKBOUND_LOCAL_DATA_CHANGED_EVENT, onLocalChange);
      window.removeEventListener(INKBOUND_CLOUD_DATA_EVENT, onCloudChange);
    };
  }, [user?.uid]);

  return null;
};
