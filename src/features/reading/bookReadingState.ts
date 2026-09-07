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
 * Repairs legacy/imported records where the explicit Finished status survived
 * but stored progress did not reach the selected edition endpoint.
 *
 * This is intentionally narrow: only already-finished books with a known total
 * are normalized. Correcting an edition length later still goes through the
 * normal progress-correction path, which can move the book back to
 * currently-reading when the corrected endpoint exceeds real progress.
 */
export function reconcileFinishedBookProgress(book: UserBookRecord): UserBookRecord {
  if (book.status !== 'finished') return book;

  const activeEdition = getActiveEdition(book);
  if (!activeEdition) return book;

  if (activeEdition.format === 'audiobook') {
    const totalMinutes = activeEdition.audiobookDurationMins;
    if (typeof totalMinutes !== 'number' || !Number.isFinite(totalMinutes) || totalMinutes <= 0) return book;
    if (book.progressMinutes === totalMinutes && book.progressPercentage === 100) return book;
    return {
      ...book,
      progressMinutes: totalMinutes,
      progressPercentage: 100,
    };
  }

  const totalPages = activeEdition.pageCount;
  if (typeof totalPages !== 'number' || !Number.isFinite(totalPages) || totalPages <= 0) return book;
  if (book.progressPages === totalPages && book.progressPercentage === 100) return book;
  return {
    ...book,
    progressPages: totalPages,
    progressPercentage: 100,
  };
}

export function getBookReadingState(book: UserBookRecord): BookReadingState {
  // The canonical resolver must not expose a stale legacy contradiction to UI.
  // Finished is authoritative when the selected edition has a known endpoint.
  const resolvedBook = reconcileFinishedBookProgress(book);
  const activeEdition = getActiveEdition(resolvedBook);
  const isAudiobook = activeEdition?.format === 'audiobook';
  const completedUnits = Math.max(0, isAudiobook ? resolvedBook.progressMinutes : resolvedBook.progressPages);
  const totalUnits = isAudiobook ? activeEdition?.audiobookDurationMins : activeEdition?.pageCount;
  const hasKnownTotal = typeof totalUnits === 'number' && Number.isFinite(totalUnits) && totalUnits > 0;
  const isFinished = resolvedBook.status === 'finished';

  const calculatedPercentage = hasKnownTotal
    ? Math.round((completedUnits / totalUnits!) * 100)
    : Math.max(0, Math.round(resolvedBook.progressPercentage || 0));
  const progressPercentage = Math.max(0, Math.min(100, calculatedPercentage));

  // A non-finished record at/above a known endpoint still needs reconciliation.
  // Finished records are normalized above, so users never receive a warning with
  // no actionable correction to make.
  const progressNeedsCorrection = hasKnownTotal
    ? !isFinished && calculatedPercentage >= 100
    : false;

  return {
    status: resolvedBook.status,
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
 * this helper so status, dates, and known-endpoint progress cannot drift apart.
 */
export function withReadingStatus(book: UserBookRecord, status: ReadingStatus, date = localDateKey()): UserBookRecord {
  if (status === 'finished') {
    return reconcileFinishedBookProgress({
      ...book,
      status,
      dateStarted: book.dateStarted ?? date,
      dateFinished: book.dateFinished ?? date,
    });
  }

  return {
    ...book,
    status,
    dateStarted: status === 'currently-reading' ? book.dateStarted ?? date : book.dateStarted,
    dateFinished: undefined,
  };
}
