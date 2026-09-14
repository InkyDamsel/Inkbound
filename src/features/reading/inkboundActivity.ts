import type { UserBookRecord } from '../../types';

export function isImportedBook(book: UserBookRecord): boolean {
  return Boolean(
    book.sourceOfImport?.toLowerCase().includes('import')
      || book.privateTags?.includes('imported')
      || book.id.startsWith('book-import-')
      || book.editions.some((edition) => edition.externalSource === 'import'),
  );
}

/**
 * Canonical reader-history date parser. Historical reporting must not invent,
 * coerce, or infer dates from dateAdded/import timestamps. Only an explicit
 * valid calendar date is allowed to place reading history on a timeline.
 */
export function canonicalReadingDateKey(value?: string): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) return null;

  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function readingMonthKey(value?: string): string | null {
  return canonicalReadingDateKey(value)?.slice(0, 7) ?? null;
}

/**
 * Historical/library reporting trusts an explicit Finished status plus a valid
 * finished date, regardless of whether that history was entered manually or
 * imported. Import verification controls metadata enrichment quality; it must
 * not erase valid reading history from dashboards, reports, or annual goals.
 */
export function hasTrustworthyFinishedHistory(book: UserBookRecord): boolean {
  return book.status === 'finished' && canonicalReadingDateKey(book.dateFinished) !== null;
}

export function getTrustworthyFinishedBooks(books: readonly UserBookRecord[]): UserBookRecord[] {
  return books.filter(hasTrustworthyFinishedHistory);
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
  if (canonicalReadingDateKey(book.dateStarted) === null) return false;
  return !isImportedBook(book) || trackedBookIds.has(book.id);
}
