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

  // Ownership and reading status are independent facts. A reader can move a
  // previously finished book to the Wishlist ownership bucket without erasing
  // its finish date/history. Do not normalize one field by rewriting the other.

  // Library-loan dates only belong to actual library loans. If ownership moves to
  // owned, subscription, borrowed-from-person, wishlist, custom, or none, keeping
  // a stale due date would continue surfacing countdown/reminder UI for a book that
  // is no longer checked out from a library.
  if (normalized.ownership !== 'borrowed-library' && normalized.libraryLoan) {
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
