import type { UserBookRecord } from '../../types';
import { normalizeBookRating, normalizeSpiceLevel } from '../reading/bookRating';
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

  const rating = normalizeBookRating(normalized.rating);
  const spiceLevel = normalizeSpiceLevel(normalized.spiceLevel);
  if (rating !== normalized.rating || spiceLevel !== normalized.spiceLevel) {
    normalized = { ...normalized, rating, spiceLevel };
  }

  if (normalized.status === 'wishlist') {
    normalized = {
      ...normalized,
      status: 'tbr',
      ownership: 'wishlist',
      customOwnershipCategoryId: undefined,
    };
  } else if (normalized.status === 'custom' && !normalized.customReadingStatusId) {
    // Legacy builds briefly used status='custom' for custom ownership before
    // custom reading statuses had their own canonical id. Preserve modern
    // custom reading statuses; only migrate records that lack that identity.
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

  // Never erase library-loan metadata during passive normalization. A stale
  // device or legacy record may temporarily disagree about ownership while sync
  // is reconciling. Clearing dates here turns a transient mismatch into permanent
  // user-data loss that can then sync to every device. Explicit ownership changes
  // clear loan dates through withBookOwnership() instead.

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
