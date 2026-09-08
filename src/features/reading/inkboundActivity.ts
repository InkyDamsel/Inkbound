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
 * Historical/library reporting trusts an explicit Finished status plus a valid
 * finished date, regardless of whether that history was entered manually or
 * imported. Import verification controls metadata enrichment quality; it must
 * not erase valid reading history from dashboards, reports, or annual goals.
 */
export function hasTrustworthyFinishedHistory(book: UserBookRecord): boolean {
  return book.status === 'finished' && hasValidDateKey(book.dateFinished);
}

/**
 * Activity-driven features (Lumis, achievements, challenges) are deliberately
 * stricter than historical reporting. Imported history can feed dashboards and
 * yearly goals when it has valid dates, but it never earns challenge or
 * achievement progress by itself. An imported title only becomes eligible after
 * the reader records actual Inkbound reading activity for that title.
 */
export function isInkboundFinishedBook(
  book: UserBookRecord,
  trackedBookIds: ReadonlySet<string>,
): boolean {
  if (book.status !== 'finished') return false;
  if (!isImportedBook(book)) return true;
  return trackedBookIds.has(book.id);
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
