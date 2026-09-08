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
 * Legacy/import reconciliation is deliberately conservative. Explicit Finished
 * status is a reading-history fact; it does not prove that Inkbound knows the
 * exact page/minute endpoint the reader reached. Do not fabricate 100% progress
 * or a full page count merely because a title is Finished.
 *
 * Older builds used this helper to force Finished records to the active edition
 * endpoint. It now exists as a compatibility boundary and intentionally returns
 * the stored record unchanged. Historical/dashboard counting is owned by
 * hasTrustworthyFinishedHistory(), which requires Finished + a valid finish date,
 * not synthetic progress.
 */
export function reconcileFinishedBookProgress(book: UserBookRecord): UserBookRecord {
  return book;
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
  const progressPercentage = Math.max(0, Math.min(100, calculatedPercentage));

  // A non-finished record at/above a known endpoint is contradictory and should
  // be corrected. A Finished record may legitimately have incomplete/unknown
  // progress (for example imported reading history), so Finished never receives
  // a "progress needs correction" warning solely for being below 100%.
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
 * this helper so status and reading-history dates cannot drift apart.
 *
 * Finished is intentionally independent from page/minute totals. Marking a title
 * Finished records the status/date but preserves the progress values the reader
 * actually entered or imported. Progress can be corrected separately without
 * erasing the finished date.
 */
export function withReadingStatus(book: UserBookRecord, status: ReadingStatus, date = localDateKey()): UserBookRecord {
  if (status === 'finished') {
    return {
      ...book,
      status,
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
