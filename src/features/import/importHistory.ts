import type { ImportRecordItem, UserBookRecord } from '../../types';
import {
  readImportEnrichmentQueue,
  writeImportEnrichmentQueue,
  type ImportEnrichmentQueueItem,
} from './libraryEnrichment';

export const IMPORT_HISTORY_STORAGE_KEY = 'inkbound_import_history_v1';
export const IMPORT_ENRICHMENT_PAUSED_KEY = 'inkbound_import_enrichment_paused_v1';
export const IMPORT_ENRICHMENT_RETRY_REQUEST_KEY = 'inkbound_import_enrichment_retry_request_v1';
export const IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY = 'inkbound_import_enrichment_retry_progress_v1';

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

export interface ImportEnrichmentRetryProgress {
  status: 'queued' | 'running' | 'complete' | 'error';
  completed: number;
  total: number;
  matched: number;
  covers: number;
  summaries: number;
  message?: string;
  updatedAt: string;
}

interface ImportEnrichmentRetryRequest {
  targetBookIds: string[];
  requestedAt: string;
}

function makeTargetBookId(recordId: string) {
  return `book-import-${recordId}`;
}

function safeIsoDate(value?: string): string | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isValidHistoryEntry(value: unknown): value is ImportHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ImportHistoryEntry>;
  return typeof entry.id === 'string'
    && typeof entry.createdAt === 'string'
    && typeof entry.sourceName === 'string'
    && typeof entry.importedCount === 'number'
    && typeof entry.duplicateCount === 'number'
    && Array.isArray(entry.items);
}

export function readImportHistory(): ImportHistoryEntry[] {
  try {
    const stored = localStorage.getItem(IMPORT_HISTORY_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidHistoryEntry);
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

  const importedBooks = books.filter((book) => {
    const source = typeof book.sourceOfImport === 'string' ? book.sourceOfImport.toLowerCase() : '';
    const tags = safeStringArray(book.privateTags);
    return source.includes('import') || tags.includes('imported') || book.id?.startsWith('book-import-');
  });
  if (importedBooks.length === 0) return [];

  const validDates = importedBooks
    .map((book) => safeIsoDate(book.dateAdded))
    .filter((value): value is string => Boolean(value))
    .sort();
  const createdAt = validDates.at(-1) ?? new Date().toISOString();

  const items: ImportHistoryItem[] = importedBooks.map((book) => {
    const editions = Array.isArray(book.editions) ? book.editions : [];
    const edition = editions.find((item) => item.id === book.activeEditionId) ?? editions[0];
    const recordId = book.id?.startsWith('book-import-') ? book.id.slice('book-import-'.length) : `legacy-${book.id}`;
    return {
      recordId,
      targetBookId: book.id,
      title: book.work?.title || 'Untitled',
      author: book.work?.author || 'Unknown Author',
      isbn: edition?.isbn13 || edition?.isbn10 || edition?.isbn,
      format: edition?.format ?? 'hardcover',
      status: book.status ?? 'tbr',
      rating: book.rating,
      dateRead: book.dateFinished,
      dateAdded: book.dateAdded || new Date().toISOString().slice(0, 10),
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
  const items = Array.isArray(entry.items) ? entry.items : [];
  const ids = new Set(items.map((item) => item.targetBookId));
  const entryBooks = books.filter((book) => ids.has(book.id));
  const queueIds = new Set(readImportEnrichmentQueue().filter((item) => ids.has(item.targetBookId)).map((item) => item.targetBookId));
  const matched = entryBooks.filter((book) => book.importMetadataVerified === true).length;
  const covers = entryBooks.filter((book) => {
    const editions = Array.isArray(book.editions) ? book.editions : [];
    const edition = editions.find((item) => item.id === book.activeEditionId) ?? editions[0];
    return Boolean(edition?.coverUrl);
  }).length;
  const summaries = entryBooks.filter((book) => Boolean(book.work?.publisherSummary?.trim())).length;

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

export function readImportEnrichmentRetryProgress(): ImportEnrichmentRetryProgress | null {
  try {
    const stored = localStorage.getItem(IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<ImportEnrichmentRetryProgress>;
    if (!parsed || typeof parsed.status !== 'string' || typeof parsed.completed !== 'number' || typeof parsed.total !== 'number') return null;
    return {
      status: parsed.status as ImportEnrichmentRetryProgress['status'],
      completed: parsed.completed,
      total: parsed.total,
      matched: parsed.matched ?? 0,
      covers: parsed.covers ?? 0,
      summaries: parsed.summaries ?? 0,
      message: parsed.message,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeImportEnrichmentRetryProgress(progress: ImportEnrichmentRetryProgress | null) {
  try {
    if (!progress) {
      localStorage.removeItem(IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY);
      return;
    }
    localStorage.setItem(IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Foreground progress is convenience state only.
  }
}

export function requestForegroundImportRetry(targetBookIds: string[]) {
  const uniqueIds = [...new Set(targetBookIds.filter(Boolean))];
  if (uniqueIds.length === 0) return;
  const requestedAt = new Date().toISOString();
  const request: ImportEnrichmentRetryRequest = { targetBookIds: uniqueIds, requestedAt };
  try {
    localStorage.setItem(IMPORT_ENRICHMENT_RETRY_REQUEST_KEY, JSON.stringify(request));
  } catch {
    // The queue itself still retains the retry work.
  }
  writeImportEnrichmentRetryProgress({
    status: 'queued',
    completed: 0,
    total: uniqueIds.length,
    matched: 0,
    covers: 0,
    summaries: 0,
    updatedAt: requestedAt,
  });
}

export function consumeForegroundImportRetryRequest(): ImportEnrichmentRetryRequest | null {
  try {
    const stored = localStorage.getItem(IMPORT_ENRICHMENT_RETRY_REQUEST_KEY);
    if (!stored) return null;
    localStorage.removeItem(IMPORT_ENRICHMENT_RETRY_REQUEST_KEY);
    const parsed = JSON.parse(stored) as Partial<ImportEnrichmentRetryRequest>;
    if (!Array.isArray(parsed.targetBookIds) || parsed.targetBookIds.length === 0) return null;
    return {
      targetBookIds: parsed.targetBookIds.filter((id): id is string => typeof id === 'string' && id.length > 0),
      requestedAt: typeof parsed.requestedAt === 'string' ? parsed.requestedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function retryImportHistoryItems(entry: ImportHistoryEntry, targetBookIds?: string[]) {
  const allowed = targetBookIds ? new Set(targetBookIds) : null;
  const existing = readImportEnrichmentQueue();
  const byBookId = new Map(existing.map((item) => [item.targetBookId, item]));
  const requestedIds: string[] = [];
  (Array.isArray(entry.items) ? entry.items : []).forEach((item) => {
    if (allowed && !allowed.has(item.targetBookId)) return;
    byBookId.set(item.targetBookId, historyItemToQueueItem(item));
    requestedIds.push(item.targetBookId);
  });
  writeImportEnrichmentQueue([...byBookId.values()]);
  requestForegroundImportRetry(requestedIds);
}
