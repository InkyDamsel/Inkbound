import type { UserBookRecord } from '../../types';

export function isImportedBook(book: UserBookRecord): boolean {
  return Boolean(
    book.sourceOfImport?.toLowerCase().includes('import')
      || book.privateTags?.includes('imported')
      || book.id.startsWith('book-import-'),
  );
}

/**
 * Returns true when a finished book can be treated as an Inkbound-era finish.
 *
 * Imported historical finishes must not inflate companion, streak/calendar,
 * achievement, or other activity-driven metrics. An imported title becomes
 * eligible once the reader actually interacts with it in Inkbound (a tracked
 * session), or finishes it in Inkbound rather than merely carrying over a
 * trustworthy historical finish date from the import source.
 */
export function isInkboundFinishedBook(
  book: UserBookRecord,
  trackedBookIds: ReadonlySet<string>,
): boolean {
  if (book.status !== 'finished') return false;
  if (!isImportedBook(book)) return true;
  if (trackedBookIds.has(book.id)) return true;

  return Boolean(book.dateFinished) && book.importFinishedDateProvided !== true;
}
