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

export function getEffectiveBookProgressPages(book: UserBookRecord): number {
  const recordedProgress = finiteNonnegative(book.progressPages);
  if (!hasTrustworthyFinishedHistory(book)) return recordedProgress;
  const pageCount = knownPrintPageCount(book);
  return pageCount === undefined ? recordedProgress : Math.max(recordedProgress, pageCount);
}

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
    if (hasTrackedPageHistoryThroughFinish) return total + trackedPagesInPeriod;

    const pageCount = knownPrintPageCount(book);
    if (pageCount === undefined) return total + trackedPagesInPeriod;

    const recordedProgress = finiteNonnegative(book.progressPages);
    return total + Math.max(trackedPagesInPeriod, recordedProgress, pageCount);
  }, 0);
}
