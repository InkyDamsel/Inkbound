import type { UserBookRecord } from '../../types';
import { reconcileFinishedBookProgress } from '../reading/bookReadingState';
import { inferSeriesHintFromTitle } from '../series/seriesLibrary';

/**
 * Imported catalog exports sometimes mark every row as owned, including
 * unpublished "Untitled (Series, #N)" placeholders. Those entries represent a
 * future installment, not something a reader can currently own/borrow/access.
 *
 * This boundary also owns legacy domain compatibility. Older Inkbound builds
 * briefly represented Wishlist as a reading status and reused the custom
 * ownership category id as a custom reading category. Current Inkbound keeps
 * reading status and ownership separate, so those old records are migrated once
 * here before any feature screen can see them.
 */
export function normalizeLibraryRecord(book: UserBookRecord): UserBookRecord {
  let normalized = reconcileFinishedBookProgress(book);

  if (normalized.status === 'wishlist') {
    normalized = {
      ...normalized,
      status: 'tbr',
      ownership: 'wishlist',
      customOwnershipCategoryId: undefined,
    };
  } else if (normalized.status === 'custom') {
    normalized = normalized.customOwnershipCategoryId
      ? {
          ...normalized,
          status: 'tbr',
          ownership: 'custom',
        }
      : {
          ...normalized,
          status: 'tbr',
        };
  }

  // Library-loan dates only belong to actual library loans. If ownership moves to
  // owned, subscription, borrowed-from-person, wishlist, custom, or none, keeping
  // a stale due date would continue surfacing countdown/reminder UI for a book that
  // is no longer checked out from a library.
  if (normalized.ownership !== 'borrowed-library' && normalized.libraryLoan) {
    normalized = { ...normalized, libraryLoan: undefined };
  }

  // A custom ownership id has no meaning unless ownership is actually custom.
  // Clearing stale ids here prevents an old category from leaking into filters or
  // future editors after the reader changes ownership.
  if (normalized.ownership !== 'custom' && normalized.customOwnershipCategoryId) {
    normalized = { ...normalized, customOwnershipCategoryId: undefined };
  }

  const isFutureUntitledSeriesPlaceholder = /^untitled\b/i.test(normalized.work.title.trim())
    && Boolean(inferSeriesHintFromTitle(normalized.work.title))
    && normalized.status !== 'finished'
    && normalized.status !== 'currently-reading';

  if (!isFutureUntitledSeriesPlaceholder) return normalized;
  if (normalized.ownership === 'none' || normalized.ownership === 'wishlist') return normalized;
  return { ...normalized, ownership: 'none', customOwnershipCategoryId: undefined };
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
