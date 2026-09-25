import type { UserBookRecord } from '../../types';
import { normalizeBookRating, normalizeSpiceLevel } from '../reading/bookRating';
import { reconcileFinishedBookProgress } from '../reading/bookReadingState';
import { inferSeriesHintFromTitle } from '../series/seriesLibrary';

/**
 * Imported catalog exports sometimes mark every row as owned, including
 * unpublished "Untitled (Series, #N)" placeholders. Those entries represent a
 * future installment, not something a reader can currently own/borrow/access.
 * Wishlist is preserved because that is an intentional reader choice.
 *
 * This boundary also applies canonical reading-state compatibility fixes before
 * the record is exposed to feature screens. Finished records are normalized
 * through bookReadingState.ts so every screen sees the same completion state.
 */
export function normalizeLibraryRecord(book: UserBookRecord): UserBookRecord {
  let normalized = reconcileFinishedBookProgress(book);

  const rating = normalizeBookRating(normalized.rating);
  const spiceLevel = normalizeSpiceLevel(normalized.spiceLevel);
  if (rating !== normalized.rating || spiceLevel !== normalized.spiceLevel) {
    normalized = { ...normalized, rating, spiceLevel };
  }

  // Ownership and reading status are independent facts. A reader can move a
  // previously finished book to the Wishlist ownership bucket without erasing
  // its finish date/history. Do not normalize one field by rewriting the other.

  // Never erase library-loan metadata during passive normalization. A stale
  // device or legacy record may temporarily disagree about ownership while sync
  // is reconciling. Clearing dates here turns a transient mismatch into permanent
  // user-data loss that can then sync to every device. Explicit ownership changes
  // clear loan dates through withBookOwnership() instead.

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
