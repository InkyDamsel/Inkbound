import type { ImportRecordItem, UserBookRecord } from '../../types';
import { readImportHistory, writeImportHistory } from './importHistory';
import {
  createFallbackImportedBook,
  queueImportedItems,
  readImportEnrichmentQueue,
  writeImportEnrichmentQueue,
} from './libraryEnrichment';
import { notifyLocalDataChanged } from '../sync/cloudSyncEvents';
import { LEGACY_SYNC_STORAGE_KEYS, SYNC_STORAGE_KEYS } from '../sync/storageKeys';

const BOOKS_STORAGE_KEY = SYNC_STORAGE_KEYS.books;
const LEGACY_BOOKS_STORAGE_KEY = LEGACY_SYNC_STORAGE_KEYS.books;
const RECOVERY_KEY_PREFIX = 'inkbound_import_hydration_recovery_v3_';

function readStoredBooks(): UserBookRecord[] {
  try {
    const raw = localStorage.getItem(BOOKS_STORAGE_KEY) ?? localStorage.getItem(LEGACY_BOOKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as UserBookRecord[] : [];
  } catch {
    return [];
  }
}

function normalizeText(value?: string): string {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
}

function compactIsbn(value?: string): string {
  return value?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';
}

function titleAuthorKey(title?: string, author?: string): string {
  const normalizedTitle = normalizeText(title);
  const normalizedAuthor = normalizeText(author);
  if (!normalizedTitle || !normalizedAuthor || normalizedAuthor === 'unknown author') return '';
  return `${normalizedTitle}::${normalizedAuthor}`;
}

function bookIsbns(book: UserBookRecord): Set<string> {
  return new Set(
    (book.editions ?? [])
      .flatMap((edition) => [edition.isbn13, edition.isbn10, edition.isbn])
      .map(compactIsbn)
      .filter(Boolean),
  );
}

function historyItemMatchesBook(
  item: ReturnType<typeof readImportHistory>[number]['items'][number],
  book: UserBookRecord,
): boolean {
  const incomingIsbn = compactIsbn(item.isbn);
  if (incomingIsbn && bookIsbns(book).has(incomingIsbn)) return true;
  const incomingKey = titleAuthorKey(item.title, item.author);
  const existingKey = titleAuthorKey(book.work?.title, book.work?.author);
  return Boolean(incomingKey && existingKey && incomingKey === existingKey);
}

function toImportRecord(item: ReturnType<typeof readImportHistory>[number]['items'][number]): ImportRecordItem {
  return {
    id: item.recordId,
    title: item.title,
    author: item.author,
    isbn: item.isbn,
    format: item.format,
    status: item.status,
    rating: item.rating,
    dateRead: item.dateRead,
    dateAdded: item.dateAdded,
    review: item.review,
    confidence: 100,
    duplicateAction: 'merge',
    coverGradient: item.coverGradient,
    importMetadataVerified: item.importMetadataVerified,
  };
}

/**
 * Repairs an older hydration race without creating duplicate books.
 *
 * Some damaged imports were rerun while only a partial library (for example 102
 * of 703 books) was visible. Those reruns received fresh import record IDs, so an
 * ID-only recovery could append all 703 rows to the 102 already present. Recovery
 * now compares ISBN first, then normalized title + author, and preserves the
 * existing library copy (including any cover/metadata already found).
 */
export function recoverIncompleteLatestImport(): number {
  try {
    const history = readImportHistory();
    const latest = history[0];
    if (!latest || latest.items.length === 0) return 0;

    const recoveryKey = `${RECOVERY_KEY_PREFIX}${latest.id}`;
    if (localStorage.getItem(recoveryKey) === 'done') return 0;

    const books = readStoredBooks();
    const latestTargetIds = new Set(latest.items.map((item) => item.targetBookId));
    const preexistingBooks = books.filter((book) => !latestTargetIds.has(book.id));

    const duplicateLatestIds = new Set(
      latest.items
        .filter((item) => preexistingBooks.some((book) => historyItemMatchesBook(item, book)))
        .map((item) => item.targetBookId),
    );

    let workingBooks = books.filter((book) => !duplicateLatestIds.has(book.id));

    if (duplicateLatestIds.size > 0) {
      const keptItems = latest.items.filter((item) => !duplicateLatestIds.has(item.targetBookId));
      const reconciledLatest = {
        ...latest,
        items: keptItems,
        importedCount: keptItems.length,
        duplicateCount: latest.duplicateCount + duplicateLatestIds.size,
      };
      writeImportHistory([reconciledLatest, ...history.slice(1)]);
    }

    const existingIds = new Set(workingBooks.map((book) => book.id));
    const missingHistoryItems = latest.items.filter((item) => {
      if (duplicateLatestIds.has(item.targetBookId)) return false;
      if (existingIds.has(item.targetBookId)) return false;
      return !workingBooks.some((book) => historyItemMatchesBook(item, book));
    });

    const missingRecords = missingHistoryItems.map(toImportRecord);
    const restored = missingRecords.map(createFallbackImportedBook);
    if (restored.length > 0 || duplicateLatestIds.size > 0) {
      workingBooks = [...workingBooks, ...restored];
      localStorage.setItem(BOOKS_STORAGE_KEY, JSON.stringify(workingBooks));
      localStorage.removeItem(LEGACY_BOOKS_STORAGE_KEY);
    }

    const queueByBookId = new Map(
      readImportEnrichmentQueue()
        .filter((item) => !duplicateLatestIds.has(item.targetBookId))
        .map((item) => [item.targetBookId, item]),
    );
    queueImportedItems(missingRecords).forEach((item) => queueByBookId.set(item.targetBookId, item));
    writeImportEnrichmentQueue([...queueByBookId.values()]);

    localStorage.setItem(recoveryKey, 'done');
    if (restored.length > 0 || duplicateLatestIds.size > 0) notifyLocalDataChanged([BOOKS_STORAGE_KEY]);

    return restored.length - duplicateLatestIds.size;
  } catch (error) {
    console.warn('Inkbound could not recover the incomplete import safely.', error);
    return 0;
  }
}
