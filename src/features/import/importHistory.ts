import type { ImportRecordItem, UserBookRecord } from '../../types';
import {
  readImportEnrichmentQueue,
  writeImportEnrichmentQueue,
  type ImportEnrichmentQueueItem,
} from './libraryEnrichment';

export const IMPORT_HISTORY_STORAGE_KEY = 'inkbound_import_history_v1';
export const IMPORT_ENRICHMENT_PAUSED_KEY = 'inkbound_import_enrichment_paused_v1';

export interface ImportHistoryItem {
  recordId: string;
  targetBookId: string;
  title: string;
  author: string;
  isbn?: string;
  format: ImportRecordItem['format'];
  status: ImportRecordItem['status'];
  rating?: number;
  dateRead?: string;
  dateAdded: string;
  review?: string;
  coverGradient: string;
}

export interface ImportHistoryEntry {
  id: string;
  createdAt: string;
  sourceName: string;
  importedCount: number;
  duplicateCount: number;
  items: ImportHistoryItem[];
}

function makeTargetBookId(recordId: string) {
  return `book-import-${recordId}`;
}

export function readImportHistory(): ImportHistoryEntry[] {
  try {
    const stored = localStorage.getItem(IMPORT_HISTORY_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? (parsed as ImportHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function writeImportHistory(entries: ImportHistoryEntry[]) {
  try {
    if (entries.length === 0) {
      localStorage.removeItem(IMPORT_HISTORY_STORAGE_KEY);
      return;
    }
    localStorage.setItem(IMPORT_HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn('Inkbound could not save import history on this device.', error);
  }
}

export function appendImportHistory(items: ImportRecordItem[], duplicateCount: number, sourceName = 'Library Import') {
  if (items.length === 0) return;
  const entry: ImportHistoryEntry = {
    id: `import-history-${Date.now()}`,
    createdAt: new Date().toISOString(),
    sourceName,
    importedCount: items.length,
    duplicateCount,
    items: items.map((item) => ({
      recordId: item.id,
      targetBookId: makeTargetBookId(item.id),
      title: item.title,
      author: item.author,
      isbn: item.isbn,
      format: item.format,
      status: item.status,
      rating: item.rating,
      dateRead: item.dateRead,
      dateAdded: item.dateAdded,
      review: item.review,
      coverGradient: item.coverGradient,
    })),
  };
  writeImportHistory([entry, ...readImportHistory()].slice(0, 50));
}

export function ensureImportHistoryForExistingLibrary(books: UserBookRecord[]): ImportHistoryEntry[] {
  const existing = readImportHistory();
  if (existing.length > 0) return existing;

  const importedBooks = books.filter((book) =>
    book.sourceOfImport?.toLowerCase().includes('import') ||
    book.privateTags.includes('imported') ||
    book.id.startsWith('book-import-'),
  );
  if (importedBooks.length === 0) return [];

  const sortedDates = importedBooks.map((book) => book.dateAdded).filter(Boolean).sort();
  const createdAt = sortedDates.at(-1)
    ? new Date(`${sortedDates.at(-1)}T12:00:00`).toISOString()
    : new Date().toISOString();
  const items: ImportHistoryItem[] = importedBooks.map((book) => {
    const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
    const recordId = book.id.startsWith('book-import-') ? book.id.slice('book-import-'.length) : `legacy-${book.id}`;
    return {
      recordId,
      targetBookId: book.id,
      title: book.work.title,
      author: book.work.author,
      isbn: edition?.isbn13 || edition?.isbn10 || edition?.isbn,
      format: edition?.format ?? 'hardcover',
      status: book.status,
      rating: book.rating,
      dateRead: book.dateFinished,
      dateAdded: book.dateAdded,
      review: book.review,
      coverGradient: edition?.coverGradient ?? 'from-[#5c3d62] via-[#35243f] to-[#171117]',
    };
  });

  const entry: ImportHistoryEntry = {
    id: 'import-history-existing-library',
    createdAt,
    sourceName: 'Existing Imported Library',
    importedCount: items.length,
    duplicateCount: 0,
    items,
  };
  writeImportHistory([entry]);
  return [entry];
}

export function isImportEnrichmentPaused(): boolean {
  try {
    return localStorage.getItem(IMPORT_ENRICHMENT_PAUSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setImportEnrichmentPaused(paused: boolean) {
  try {
    if (paused) localStorage.setItem(IMPORT_ENRICHMENT_PAUSED_KEY, 'true');
    else localStorage.removeItem(IMPORT_ENRICHMENT_PAUSED_KEY);
  } catch {
    // Best-effort preference only.
  }
}

export function getImportHistoryProgress(entry: ImportHistoryEntry, books: UserBookRecord[]) {
  const ids = new Set(entry.items.map((item) => item.targetBookId));
  const entryBooks = books.filter((book) => ids.has(book.id));
  const queueIds = new Set(readImportEnrichmentQueue().filter((item) => ids.has(item.targetBookId)).map((item) => item.targetBookId));
  const matched = entryBooks.filter((book) => book.importMetadataVerified === true).length;
  const covers = entryBooks.filter((book) => {
    const edition = book.editions.find((item) => item.id === book.activeEditionId) ?? book.editions[0];
    return Boolean(edition?.coverUrl);
  }).length;
  const summaries = entryBooks.filter((book) => Boolean(book.work.publisherSummary?.trim())).length;

  return {
    present: entryBooks.length,
    matched,
    covers,
    summaries,
    queued: queueIds.size,
    unresolved: Math.max(0, entryBooks.length - matched),
  };
}

function historyItemToQueueItem(item: ImportHistoryItem): ImportEnrichmentQueueItem {
  return {
    id: item.recordId,
    targetBookId: item.targetBookId,
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
    attempts: 0,
  };
}

export function retryImportHistoryItems(entry: ImportHistoryEntry, targetBookIds?: string[]) {
  const allowed = targetBookIds ? new Set(targetBookIds) : null;
  const existing = readImportEnrichmentQueue();
  const byBookId = new Map(existing.map((item) => [item.targetBookId, item]));
  entry.items.forEach((item) => {
    if (allowed && !allowed.has(item.targetBookId)) return;
    byBookId.set(item.targetBookId, historyItemToQueueItem(item));
  });
  writeImportEnrichmentQueue([...byBookId.values()]);
}
