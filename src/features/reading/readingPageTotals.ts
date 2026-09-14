import type { ReadingSession, UserBookRecord } from '../../types';
import { getActiveEdition } from './bookReadingState';
import { canonicalReadingDateKey, hasTrustworthyFinishedHistory } from './inkboundActivity';
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
 * There are two legitimate evidence paths and they must never be added together
 * for the same finished book:
 *
 * 1. Tracked Inkbound page sessions are authoritative for period math. If Inkbound
 *    has page-session history through a book's finish date, a monthly/yearly report
 *    uses only the pages actually tracked inside that requested period.
 * 2. Historical imports/manual history may have a trustworthy finish date and a
 *    known print/ebook page count but no session history. In that case the edition
 *    page count is used as the historical floor in the period containing the finish.
 *
 * This prevents the old double-count failure where a 500-page book read across two
 * months could contribute its tracked pages in month one and then another full 500
 * pages in the finish month. It also preserves imported reading history when the
 * source supplied a real finish date but Inkbound never observed the original read.
 *
 * This is derived reporting only. It never rewrites progressPages or creates
 * synthetic sessions, so persistence remains the canonical stored history.
 */
export function getEffectivePagesReadForPeriod(
  books: UserBookRecord[],
  sessions: ReadingSession[],
  startDate: string,
  endDate: string,
): number {
  const normalizedStartDate = canonicalReadingDateKey(startDate);
  const normalizedEndDate = canonicalReadingDateKey(endDate);
  if (!normalizedStartDate || !normalizedEndDate || normalizedStartDate > normalizedEndDate) return 0;

  const eligibleBookIds = new Set(books.map((book) => book.id));
  const trackedPagesInPeriodByBook = new Map<string, number>();
  const trackedPageDatesByBook = new Map<string, string[]>();

  sessions.forEach((session) => {
    if (!eligibleBookIds.has(session.bookId)) return;
    const pages = getSessionPagesRead(session);
    if (pages <= 0) return;

    const sessionDate = canonicalReadingDateKey(session.date);
    if (!sessionDate) return;

    trackedPageDatesByBook.set(
      session.bookId,
      [...(trackedPageDatesByBook.get(session.bookId) ?? []), sessionDate],
    );

    if (sessionDate < normalizedStartDate || sessionDate > normalizedEndDate) return;
    trackedPagesInPeriodByBook.set(
      session.bookId,
      (trackedPagesInPeriodByBook.get(session.bookId) ?? 0) + pages,
    );
  });

  return books.reduce((total, book) => {
    const trackedPagesInPeriod = trackedPagesInPeriodByBook.get(book.id) ?? 0;
    const finishedDate = hasTrustworthyFinishedHistory(book)
      ? canonicalReadingDateKey(book.dateFinished)
      : null;
    const finishedInPeriod = finishedDate !== null
      && finishedDate >= normalizedStartDate
      && finishedDate <= normalizedEndDate;

    if (!finishedInPeriod) return total + trackedPagesInPeriod;

    const trackedDates = trackedPageDatesByBook.get(book.id) ?? [];
    const hasTrackedPageHistoryThroughFinish = trackedDates.some((date) => date <= finishedDate);

    // Once Inkbound has real page history for the original read, that history is
    // authoritative. Do not drop a whole-book fallback into the finish month.
    if (hasTrackedPageHistoryThroughFinish) return total + trackedPagesInPeriod;

    const pageCount = knownPrintPageCount(book);
    if (pageCount === undefined) return total + trackedPagesInPeriod;

    const recordedProgress = finiteNonnegative(book.progressPages);
    return total + Math.max(trackedPagesInPeriod, recordedProgress, pageCount);
  }, 0);
}