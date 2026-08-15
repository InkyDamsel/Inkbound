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

  // Never hide contradictory canonical state behind a cosmetic 100% value.
  // A finished book below its known endpoint, or a non-finished book at/above it,
  // needs reconciliation rather than a UI-only correction.
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
  return {
    ...book,
    status,
    dateFinished: status === 'finished' ? book.dateFinished ?? date : undefined,
  };
}
