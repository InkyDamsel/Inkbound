import type { UserBookRecord } from '../../types';
import { inferSeriesHintFromTitle } from '../series/seriesLibrary';

/**
 * Imported catalog exports sometimes mark every row as owned, including
 * unpublished "Untitled (Series, #N)" placeholders. Those entries represent a
 * future installment, not something a reader can currently own/borrow/access.
 * Wishlist is preserved because that is an intentional reader choice.
 */
export function normalizeLibraryRecord(book: UserBookRecord): UserBookRecord {
  const isFutureUntitledSeriesPlaceholder = /^untitled\b/i.test(book.work.title.trim())
    && Boolean(inferSeriesHintFromTitle(book.work.title))
    && book.status !== 'finished'
    && book.status !== 'currently-reading';

  if (!isFutureUntitledSeriesPlaceholder) return book;
  if (book.ownership === 'none' || book.ownership === 'wishlist') return book;
  return { ...book, ownership: 'none' };
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
