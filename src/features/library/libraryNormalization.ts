import type { UserBookRecord } from '../../types';
import { inferSeriesHintFromTitle } from '../series/seriesLibrary';

/**
 * Imported catalog exports sometimes mark every row as owned, including
 * unpublished "Untitled (Series, #N)" placeholders. Those entries represent a
 * future installment, not something a reader can currently own/borrow/access.
 * Wishlist is preserved because that is an intentional reader choice.
 */
export function normalizeLibraryRecord(book: UserBookRecord): UserBookRecord {
  let normalized = book;

  // Ownership and reading status are separate concepts, but a title explicitly
  // moved to the Wishlist cannot simultaneously remain a finished/read item.
  // This repairs older contradictory records without treating ordinary TBR
  // ownership changes as reading activity.
  if (normalized.ownership === 'wishlist' && normalized.status === 'finished') {
    normalized = {
      ...normalized,
      status: 'wishlist',
      dateFinished: undefined,
    };
  }

  // Person-to-person borrowing does not use the library-loan due-date model.
  if (normalized.ownership === 'borrowed-person' && normalized.libraryLoan) {
    normalized = { ...normalized, libraryLoan: undefined };
  }

  const isFutureUntitledSeriesPlaceholder = /^untitled\b/i.test(normalized.work.title.trim())
    && Boolean(inferSeriesHintFromTitle(normalized.work.title))
    && normalized.status !== 'finished'
    && normalized.status !== 'currently-reading';

  if (!isFutureUntitledSeriesPlaceholder) return normalized;
  if (normalized.ownership === 'none' || normalized.ownership === 'wishlist') return normalized;
  return { ...normalized, ownership: 'none' };
}

export function normalizeCanonicalLibraryRecords(books: UserBookRecord[]): {
  books: UserBookRecord[];
  changed: boolean;
} {
  let changed = false;
  const normalized = books.map((book) => {
    const next = normalizeLibraryRecord(book);
    if (next !== book) changed = true;
    return next;
  });
  return { books: normalized, changed };
}
