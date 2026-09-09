import type { Edition, ReadingStatus, UserBookRecord } from '../../types';
import { localDateKey } from './sessionAnalytics';

export interface BookReadingState {
  status: ReadingStatus;
  isFinished: boolean;
  activeEdition?: Edition;
  completedUnits: number;
  totalUnits?: number;
  progressPercentage: number;
  progressNeedsCorrection: boolean;
}

export function getActiveEdition(book: UserBookRecord): Edition | undefined {
  return book.editions.find((edition) => edition.id === book.activeEditionId) ?? book.editions[0];
}

/**
 * Finished and 100% are one canonical reading state in Inkbound.
 *
 * Imported trackers often carry an explicit Read/Finished shelf without an exact
 * page/minute endpoint. We should not invent historical page numbers, but a title
 * explicitly marked Finished is complete and must present as 100% everywhere.
 * This helper normalizes the stored percentage while leaving page/minute endpoints
 * untouched when the source did not provide them.
 */
export function reconcileFinishedBookProgress(book: UserBookRecord): UserBookRecord {
  if (book.status !== 'finished' || book.progressPercentage === 100) return book;
  return { ...book, progressPercentage: 100 };
}

export function getBookReadingState(book: UserBookRecord): BookReadingState {
  const activeEdition = getActiveEdition(book);
  const isAudiobook = activeEdition?.format === 'audiobook';
  const completedUnits = Math.max(0, isAudiobook ? book.progressMinutes : book.progressPages);
  const totalUnits = isAudiobook ? activeEdition?.audiobookDurationMins : activeEdition?.pageCount;
  const hasKnownTotal = typeof totalUnits === 'number' && Number.isFinite(totalUnits) && totalUnits > 0;
  const isFinished = book.status === 'finished';

  const calculatedPercentage = hasKnownTotal
    ? Math.round((completedUnits / totalUnits!) * 100)
    : Math.max(0, Math.round(book.progressPercentage || 0));
  const progressPercentage = isFinished
    ? 100
    : Math.max(0, Math.min(100, calculatedPercentage));

  // A non-finished record at/above a known endpoint is contradictory and should
  // be corrected. Finished is already canonical 100% regardless of whether an
  // imported source supplied the exact final page/minute endpoint.
  const progressNeedsCorrection = hasKnownTotal
    ? !isFinished && calculatedPercentage >= 100
    : false;

  return {
    status: book.status,
    isFinished,
    activeEdition,
    completedUnits,
    totalUnits: hasKnownTotal ? totalUnits : undefined,
    progressPercentage,
    progressNeedsCorrection,
  };
}

/**
 * Canonical reading-status transition. Any surface that changes status should use
 * this helper so status, completion percentage, and reading-history dates cannot
 * drift apart.
 *
 * Marking a title Finished means 100% complete. We do not fabricate an exact
 * page/minute endpoint when one is unknown; the percentage and Finished status
 * are the canonical completion signal while the finish date records when the
 * reader explicitly marks it complete inside Inkbound.
 */
export function withReadingStatus(book: UserBookRecord, status: ReadingStatus, date = localDateKey()): UserBookRecord {
  if (status === 'finished') {
    return {
      ...book,
      status,
      progressPercentage: 100,
      dateStarted: book.dateStarted ?? date,
      dateFinished: book.dateFinished ?? date,
    };
  }

  return {
    ...book,
    status,
    dateStarted: status === 'currently-reading' ? book.dateStarted ?? date : book.dateStarted,
    dateFinished: undefined,
  };
}
