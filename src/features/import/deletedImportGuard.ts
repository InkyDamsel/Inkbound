import type { ImportRecordItem, UserBookRecord } from '../../types';
import { readImportHistory, type ImportHistoryEntry } from './importHistory';

const normalized = (value?: string): string =>
  value?.trim().toLocaleLowerCase().normalize('NFKC').replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
const compactIsbn = (value?: string): string =>
  value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';

/**
 * Previously imported, now missing is ambiguous: explicit deletion, an offline
 * snapshot gap, or an interrupted migration. None authorizes silently
 * recreating a book. Require a separate, reader-confirmed restore workflow.
 *
 * Existing import audit events are evidence; this function never alters them.
 */
export function findPreviouslyRemovedImportRows(
  rows: ImportRecordItem[],
  library: UserBookRecord[],
  history: ImportHistoryEntry[] = readImportHistory(),
): ImportRecordItem[] {
  const ownedIds = new Set(library.map((book) => book.id));
  const missing = history.flatMap((entry) => entry.items)
    .filter((item) => !ownedIds.has(item.targetBookId));
  return rows.filter((row) => missing.some((item) => {
    const incoming = compactIsbn(row.isbn);
    const previous = compactIsbn(item.isbn);
    if (incoming && previous) return incoming === previous;
    return Boolean(normalized(row.title) && normalized(row.author)
      && normalized(row.title) === normalized(item.title)
      && normalized(row.author) === normalized(item.author));
  }));
}
