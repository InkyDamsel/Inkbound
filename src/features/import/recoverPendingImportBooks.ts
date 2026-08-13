import type { UserBookRecord } from '../../types';
import {
  createFallbackImportedBook,
  queueImportedItems,
  readImportEnrichmentQueue,
  writeImportEnrichmentQueue,
} from './libraryEnrichment';
import { readImportMetadataPending } from './importVerificationJob';

const BOOKS_STORAGE_KEY = 'inkbound_books';
const LEGACY_BOOKS_STORAGE_KEY = 'bookhaven_books';

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

/**
 * Repairs a DEV/production hydration race from older builds where an import could
 * finish while Firebase was still restoring the account library. The stale
 * hydration snapshot could then overwrite newly imported fallback records.
 *
 * The durable "awaiting metadata" list still contains the original export rows,
 * so missing records can be recreated without guessing or changing user data.
 * Existing records always win, which preserves covers and metadata already found.
 */
export function recoverPendingImportBooks(): number {
  try {
    const pending = readImportMetadataPending();
    if (pending.length === 0) return 0;

    const books = readStoredBooks();
    const existingIds = new Set(books.map((book) => book.id));
    const missing = pending.filter((item) => !existingIds.has(`book-import-${item.id}`));
    if (missing.length === 0) return 0;

    const restored = missing.map(createFallbackImportedBook);
    const mergedBooks = [...books, ...restored];
    localStorage.setItem(BOOKS_STORAGE_KEY, JSON.stringify(mergedBooks));
    localStorage.removeItem(LEGACY_BOOKS_STORAGE_KEY);

    const queueByBookId = new Map(
      readImportEnrichmentQueue().map((item) => [item.targetBookId, item]),
    );
    queueImportedItems(missing).forEach((item) => queueByBookId.set(item.targetBookId, item));
    writeImportEnrichmentQueue([...queueByBookId.values()]);

    return restored.length;
  } catch (error) {
    console.warn('Inkbound could not recover pending imported books safely.', error);
    return 0;
  }
}
