import type { Edition, ReadingStatus, UserBookRecord } from '../../types';

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

  // Contradictions should be rare after canonical reconciliation, but keep this
  // signal for genuinely inconsistent non-finished records and failed migrations.
  const progressNeedsCorrection = hasKnownTotal
    ? (isFinished && calculatedPercentage < 100) || (!isFinished && calculatedPercentage >= 100)
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

function localDateKey(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function withReadingStatus(book: UserBookRecord, status: ReadingStatus, date = localDateKey()): UserBookRecord {
  const nextBook: UserBookRecord = {
    ...book,
    status,
    dateFinished: status === 'finished' ? book.dateFinished ?? date : undefined,
  };
  return status === 'finished' ? reconcileFinishedBookProgress(nextBook) : nextBook;
}
