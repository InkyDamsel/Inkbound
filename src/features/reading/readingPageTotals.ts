import type { ReadingSession, UserBookRecord } from '../../types';
import { getActiveEdition } from './bookReadingState';
import { hasTrustworthyFinishedHistory } from './inkboundActivity';
import { getSessionPagesRead } from './sessionAnalytics';

const finiteNonnegative = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;

const knownPrintPageCount = (book: UserBookRecord): number | undefined => {
  const edition = getActiveEdition(book);
  if (!edition || edition.format === 'audiobook') return undefined;
  const pageCount = edition.pageCount;
  return typeof pageCount === 'number' && Number.isFinite(pageCount) && pageCount > 0
    ? pageCount
    : undefined;
};

/**
 * Canonical display value for a book's page progress.
 *
 * A trustworthy finished print/ebook with a known page count should not present
 * itself as "100% / 0 pages" merely because the historical page endpoint was not
 * stored. This derives the visible value without rewriting the reader's history.
 */
export function getEffectiveBookProgressPages(book: UserBookRecord): number {
  const recordedProgress = finiteNonnegative(book.progressPages);
  if (!hasTrustworthyFinishedHistory(book)) return recordedProgress;
  const pageCount = knownPrintPageCount(book);
  return pageCount === undefined ? recordedProgress : Math.max(recordedProgress, pageCount);
}

/**
 * Canonical page total for historical/statistical reporting.
 *
 * Session endpoints remain the most precise source when readers log activity.
 * But a trustworthy Finished record with a known print/ebook page count must not
 * contribute zero pages simply because its exact historical sessions were never
 * recorded in Inkbound. In that case we use the edition page count as the floor.
 *
 * This is a derived reporting value only. It never rewrites progressPages or
 * creates synthetic sessions, so the reader's stored history remains untouched.
 */
export function getEffectivePagesReadForPeriod(
  books: UserBookRecord[],
  sessions: ReadingSession[],
  startDate: string,
  endDate: string,
): number {
  const eligibleBookIds = new Set(books.map((book) => book.id));
  const trackedPagesByBook = new Map<string, number>();

  sessions.forEach((session) => {
    if (!eligibleBookIds.has(session.bookId)) return;
    if (session.date < startDate || session.date > endDate) return;
    const pages = getSessionPagesRead(session);
    trackedPagesByBook.set(session.bookId, (trackedPagesByBook.get(session.bookId) ?? 0) + pages);
  });

  return books.reduce((total, book) => {
    const trackedPages = trackedPagesByBook.get(book.id) ?? 0;
    const finishedInPeriod = hasTrustworthyFinishedHistory(book)
      && book.dateFinished! >= startDate
      && book.dateFinished! <= endDate;

    if (!finishedInPeriod) return total + trackedPages;

    const pageCount = knownPrintPageCount(book);
    if (pageCount === undefined) return total + trackedPages;

    const recordedProgress = finiteNonnegative(book.progressPages);
    return total + Math.max(trackedPages, recordedProgress, pageCount);
  }, 0);
}
