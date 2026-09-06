import type { UserBookRecord } from '../../types';

export function isImportedBook(book: UserBookRecord): boolean {
  return Boolean(
    book.sourceOfImport?.toLowerCase().includes('import')
      || book.privateTags?.includes('imported')
      || book.id.startsWith('book-import-')
      || book.editions.some((edition) => edition.externalSource === 'import'),
  );
}

const hasValidDateKey = (value?: string): boolean => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day, 12);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
};

/**
 * Historical/library reporting may use an imported finish only when the import
 * supplied a real finished date and that record is not marked as questionable.
 */
export function hasTrustworthyFinishedHistory(book: UserBookRecord): boolean {
  if (book.status !== 'finished' || !hasValidDateKey(book.dateFinished)) return false;
  if (!isImportedBook(book)) return true;
  return book.importFinishedDateProvided === true
    && book.importMetadataReviewNeeded !== true
    && book.importMetadataVerified !== false;
}

/**
 * Activity-driven features (Lumis, achievements, challenges) are stricter than
 * historical reporting. Imported history does not become Inkbound activity just
 * because it contains old dates. The reader must actually interact with the book
 * in Inkbound, or finish an imported book after bringing it into Inkbound.
 */
export function isInkboundFinishedBook(
  book: UserBookRecord,
  trackedBookIds: ReadonlySet<string>,
): boolean {
  if (book.status !== 'finished') return false;
  if (!isImportedBook(book)) return true;
  if (trackedBookIds.has(book.id)) return true;

  return hasValidDateKey(book.dateFinished) && book.importFinishedDateProvided !== true;
}

/** Imported currently-reading rows only count as active Inkbound reading after
 * the reader has actually logged activity for the title in Inkbound. */
export function isInkboundActiveBook(
  book: UserBookRecord,
  trackedBookIds: ReadonlySet<string>,
): boolean {
  if (book.status !== 'currently-reading') return false;
  return !isImportedBook(book) || trackedBookIds.has(book.id);
}

/**
 * Used by start-based challenges. Old imported start dates are history, not a
 * challenge action. A non-imported start date is eligible; imported books only
 * become eligible through tracked Inkbound activity.
 */
export function isInkboundStartedBook(
  book: UserBookRecord,
  trackedBookIds: ReadonlySet<string>,
): boolean {
  if (!hasValidDateKey(book.dateStarted)) return false;
  return !isImportedBook(book) || trackedBookIds.has(book.id);
}
