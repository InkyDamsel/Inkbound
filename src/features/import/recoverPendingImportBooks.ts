import type { ImportRecordItem, UserBookRecord } from '../../types';
import { readImportHistory } from './importHistory';
import {
  createFallbackImportedBook,
  queueImportedItems,
  readImportEnrichmentQueue,
  writeImportEnrichmentQueue,
} from './libraryEnrichment';
import { notifyLocalDataChanged } from '../sync/cloudSyncEvents';

const BOOKS_STORAGE_KEY = 'inkbound_books';
const LEGACY_BOOKS_STORAGE_KEY = 'bookhaven_books';
const RECOVERY_KEY_PREFIX = 'inkbound_import_hydration_recovery_v2_';

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
 * Repairs the older hydration race where Firebase could replace a just-imported
 * local library with the pre-import cloud snapshot. Import History contains the
 * complete committed manifest, including both metadata-matched and unmatched
 * books, so it is the only safe recovery source for the damaged import.
 *
 * This repair only considers the latest import and runs once for that import ID.
 * Future imports are protected by the cloud hydration gate and should never need
 * this repair path.
 */
export function recoverIncompleteLatestImport(): number {
  try {
    const latest = readImportHistory()[0];
    if (!latest || latest.items.length === 0) return 0;

    const recoveryKey = `${RECOVERY_KEY_PREFIX}${latest.id}`;
    if (localStorage.getItem(recoveryKey) === 'done') return 0;

    const books = readStoredBooks();
    const existingIds = new Set(books.map((book) => book.id));
    const missingHistoryItems = latest.items.filter((item) => !existingIds.has(item.targetBookId));

    // A complete import needs no repair. Mark it so we never reinterpret later
    // intentional deletions as a failed import.
    if (missingHistoryItems.length === 0) {
      localStorage.setItem(recoveryKey, 'done');
      return 0;
    }

    const missingRecords = missingHistoryItems.map(toImportRecord);
    const restored = missingRecords.map(createFallbackImportedBook);
    localStorage.setItem(BOOKS_STORAGE_KEY, JSON.stringify([...books, ...restored]));
    localStorage.removeItem(LEGACY_BOOKS_STORAGE_KEY);

    const queueByBookId = new Map(
      readImportEnrichmentQueue().map((item) => [item.targetBookId, item]),
    );
    queueImportedItems(missingRecords).forEach((item) => queueByBookId.set(item.targetBookId, item));
    writeImportEnrichmentQueue([...queueByBookId.values()]);

    localStorage.setItem(recoveryKey, 'done');
    notifyLocalDataChanged([BOOKS_STORAGE_KEY]);
    return restored.length;
  } catch (error) {
    console.warn('Inkbound could not recover the incomplete import safely.', error);
    return 0;
  }
}
