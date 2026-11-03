import type { ImportRecordItem, UserBookRecord } from '../../types';
import {
  readImportEnrichmentQueue,
  writeImportEnrichmentQueue,
  type ImportEnrichmentQueueItem,
} from './libraryEnrichment';
import { readImportMetadataPending } from './importVerificationJob';
import { LEGACY_SYNC_STORAGE_KEYS, SYNC_STORAGE_KEYS } from '../sync/storageKeys';

export const IMPORT_HISTORY_STORAGE_KEY = 'inkbound_import_history_v1';
export const IMPORT_HISTORY_CHANGED_EVENT = 'inkbound:import-history-changed';
export const IMPORT_ENRICHMENT_PAUSED_KEY = SYNC_STORAGE_KEYS.importEnrichmentPaused;
// Kept only so older recovery snapshots containing this retired key can still
// be restored/cleared safely. Foreground retries no longer use this handoff.
export const IMPORT_ENRICHMENT_RETRY_REQUEST_KEY = 'inkbound_import_enrichment_retry_request_v1';
export const IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY = SYNC_STORAGE_KEYS.importEnrichmentRetryProgress;
export const IMPORT_ENRICHMENT_ACTIVE_RETRY_KEY = SYNC_STORAGE_KEYS.importEnrichmentActiveRetry;

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
  importMetadataVerified?: boolean;
}

export interface ImportRowOutcome {
  recordId: string;
  targetBookId?: string;
  title: string;
  author: string;
  outcome: 'added' | 'updated' | 'unchanged' | 'skipped' | 'failed';
  reason?: string;
}

export interface ImportHistoryEntry {
  id: string;
  createdAt: string;
  sourceName: string;
  importedCount: number;
  duplicateCount: number;
  totalCount?: number;
  enrichedCount?: number;
  unchangedCount?: number;
  items: ImportHistoryItem[];
  /** Immutable per-row log. Older history entries may not have this field. */
  outcomes?: ImportRowOutcome[];
  status?: 'running' | 'completed' | 'failed';
  failureReason?: string;
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

export interface ImportEnrichmentActiveRetry {
  entryId: string;
  targetBookIds: string[];
  startedAt: string;
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

function readCurrentLibrary(): UserBookRecord[] {
  try {
    const stored = localStorage.getItem(SYNC_STORAGE_KEYS.books)
      ?? localStorage.getItem(LEGACY_SYNC_STORAGE_KEYS.books);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? parsed as UserBookRecord[] : [];
  } catch {
    return [];
  }
}

function hasManualActiveEdition(book?: UserBookRecord): boolean {
  if (!book) return false;
  const editions = Array.isArray(book.editions) ? book.editions : [];
  const activeEdition = editions.find((edition) => edition.id === book.activeEditionId) ?? editions[0];
  return activeEdition?.externalSource === 'manual';
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

export function writeImportHistory(entries: ImportHistoryEntry[]): boolean {
  try {
    if (entries.length === 0) {
      localStorage.removeItem(IMPORT_HISTORY_STORAGE_KEY);
      return true;
    }
    localStorage.setItem(IMPORT_HISTORY_STORAGE_KEY, JSON.stringify(entries));
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(IMPORT_HISTORY_CHANGED_EVENT));
    return true;
  } catch (error) {
    console.warn('Inkbound could not save import history on this device.', error);
    return false;
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
      importMetadataVerified: item.importMetadataVerified === true,
    })),
  };
  writeImportHistory([entry, ...readImportHistory()]);
}

/** Persist a durable operation ID before any library mutations begin. */
export function beginImportAudit(sessionId: string, submitted: ImportRecordItem[], skipped: ImportRecordItem[], sourceName?: string): void {
  const previous = readImportHistory();
  if (previous.some((entry) => entry.id === sessionId)) throw new Error('Import session ID already exists.');
  const entry: ImportHistoryEntry = {
    id: sessionId,
    createdAt: new Date().toISOString(),
    sourceName: sourceName || 'Library Import',
    importedCount: 0,
    duplicateCount: skipped.length,
    totalCount: new Set([...submitted, ...skipped].map((item) => item.id)).size,
    unchangedCount: 0,
    enrichedCount: 0,
    items: [],
    outcomes: [],
    status: 'running',
  };
  if (!writeImportHistory([entry, ...previous])) {
    throw new Error('Import history could not be saved. No books were changed.');
  }
}

export function failImportAudit(sessionId: string, reason: string): void {
  const history = readImportHistory();
  const entry = history.find((item) => item.id === sessionId);
  if (!entry || entry.status === 'completed') return;
  const updated = history.map((item) => item.id === sessionId ? {
    ...item,
    status: 'failed' as const,
    failureReason: reason,
  } : item);
  if (!writeImportHistory(updated)) {
    throw new Error('Import failed, and its failure record could not be persisted.');
  }
}

/** Append an immutable audit of a completed import, including zero-new-book imports.
 * Existing imported-book history remains readable; never truncate prior entries.
 */
export function appendCompletedImportAudit(args: {
  submitted: ImportRecordItem[];
  added: ImportRecordItem[];
  enriched: ImportRecordItem[];
  unchanged?: ImportRecordItem[];
  skipped: ImportRecordItem[];
  sourceName?: string;
  sessionId?: string;
}): void {
  const toItem = (item: ImportRecordItem): ImportHistoryItem => ({
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
    importMetadataVerified: item.importMetadataVerified === true,
  });
  const added = new Map(args.added.map((item) => [item.id, item]));
  const updated = new Map(args.enriched.map((item) => [item.id, item]));
  const unchanged = new Map((args.unchanged ?? []).map((item) => [item.id, item]));
  const skipped = new Map(args.skipped.map((item) => [item.id, item]));
  const all = new Map([...args.submitted, ...args.skipped].map((item) => [item.id, item]));
  const outcomes: ImportRowOutcome[] = [...all.values()].map((item) => {
    const outcome: ImportRowOutcome['outcome'] = added.has(item.id) ? 'added'
      : updated.has(item.id) ? 'updated'
        : unchanged.has(item.id) ? 'unchanged' : 'skipped';
    return {
      recordId: item.id,
      targetBookId: item.matchedBookId || (added.has(item.id) ? makeTargetBookId(item.id) : undefined),
      title: item.title,
      author: item.author,
      outcome,
      ...(outcome === 'skipped' ? { reason: skipped.has(item.id) ? 'Already present or skipped in preview' : 'Not selected' } : {}),
    };
  });
  const existingHistory = readImportHistory();
  const started = args.sessionId ? existingHistory.find((item) => item.id === args.sessionId) : undefined;
  if (args.sessionId && !started) throw new Error('Import session was not persisted before completion.');
  const entry: ImportHistoryEntry = {
    id: args.sessionId ?? `import-audit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: started?.createdAt ?? new Date().toISOString(),
    sourceName: args.sourceName ?? started?.sourceName ?? 'Library Import',
    importedCount: args.added.length,
    duplicateCount: outcomes.filter((item) => item.outcome === 'skipped').length,
    totalCount: outcomes.length,
    enrichedCount: args.enriched.length,
    unchangedCount: unchanged.size,
    items: args.added.map(toItem),
    outcomes,
    status: 'completed',
  };
  const updatedHistory = started
    ? existingHistory.map((item) => item.id === started.id ? entry : item)
    : [entry, ...existingHistory];
  if (!writeImportHistory(updatedHistory)) {
    throw new Error('Import books may have saved, but the import audit could not be persisted. Please do not repeat the import until history storage is available.');
  }
}

function reconcileHistoryWithPendingVerification(entries: ImportHistoryEntry[]): ImportHistoryEntry[] {
  const pending = readImportMetadataPending();
  if (pending.length === 0) return entries;

  const pendingIds = new Set(pending.map((item) => item.id));
  let changed = false;
  const reconciled = entries.map((entry) => {
    const overlapsCurrentVerification = entry.items.some((item) => pendingIds.has(item.recordId));
    if (!overlapsCurrentVerification) return entry;

    const items = entry.items.map((item) => {
      if (item.importMetadataVerified !== undefined) return item;
      changed = true;
      return {
        ...item,
        importMetadataVerified: !pendingIds.has(item.recordId),
      };
    });
    return { ...entry, items };
  });

  if (changed) writeImportHistory(reconciled);
  return reconciled;
}

export function ensureImportHistoryForExistingLibrary(books: UserBookRecord[]): ImportHistoryEntry[] {
  if (books.length === 0) return readImportHistory();

  const storedHistory = reconcileHistoryWithPendingVerification(readImportHistory());
  // Import history is an audit log, not a list of currently owned books.
  // Never discard zero-new-book batches or records whose books changed later.
  const existing = storedHistory;
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
      importMetadataVerified: book.importMetadataVerified === true,
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
  // Legacy reconstruction is display-only. It is not a real import event
  // and must never enter the durable audit ledger or trigger recovery.
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

export function isImportHistoryItemMatched(item: ImportHistoryItem, book?: UserBookRecord): boolean {
  return item.importMetadataVerified === true || book?.importMetadataVerified === true;
}

export function getImportHistoryProgress(entry: ImportHistoryEntry, books: UserBookRecord[]) {
  const items = Array.isArray(entry.items) ? entry.items : [];
  const ids = new Set(items.map((item) => item.targetBookId));
  const booksById = new Map(books.filter((book) => ids.has(book.id)).map((book) => [book.id, book]));
  const entryBooks = [...booksById.values()];
  const queueIds = new Set(readImportEnrichmentQueue().filter((item) => ids.has(item.targetBookId)).map((item) => item.targetBookId));
  const matched = items.filter((item) => isImportHistoryItemMatched(item, booksById.get(item.targetBookId))).length;
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
    unresolved: Math.max(0, entry.importedCount - matched),
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

function normalizeRetryProgress(progress: ImportEnrichmentRetryProgress): ImportEnrichmentRetryProgress {
  const stillMarkedActive = progress.status === 'queued' || progress.status === 'running';
  const allRequestedBooksChecked = progress.total > 0 && progress.completed >= progress.total;
  if (!stillMarkedActive || !allRequestedBooksChecked) return progress;

  return {
    ...progress,
    status: 'complete',
    completed: progress.total,
    message: progress.message ?? `${progress.total.toLocaleString()} books were checked. Books that still could not be matched remain safely queued for a future manual retry.`,
    updatedAt: new Date().toISOString(),
  };
}

export function readImportEnrichmentRetryProgress(): ImportEnrichmentRetryProgress | null {
  try {
    const stored = localStorage.getItem(IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<ImportEnrichmentRetryProgress>;
    if (!parsed || typeof parsed.status !== 'string' || typeof parsed.completed !== 'number' || typeof parsed.total !== 'number') return null;
    const progress = normalizeRetryProgress({
      status: parsed.status as ImportEnrichmentRetryProgress['status'],
      completed: parsed.completed,
      total: parsed.total,
      matched: parsed.matched ?? 0,
      covers: parsed.covers ?? 0,
      summaries: parsed.summaries ?? 0,
      message: parsed.message,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    });

    if (progress.status === 'complete' && (parsed.status === 'queued' || parsed.status === 'running')) {
      localStorage.setItem(IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY, JSON.stringify(progress));
      writeImportEnrichmentActiveRetry(null);
    }

    return progress;
  } catch {
    return null;
  }
}

export function readImportEnrichmentActiveRetry(): ImportEnrichmentActiveRetry | null {
  try {
    const stored = localStorage.getItem(IMPORT_ENRICHMENT_ACTIVE_RETRY_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<ImportEnrichmentActiveRetry>;
    if (!parsed || typeof parsed.entryId !== 'string' || !Array.isArray(parsed.targetBookIds)) return null;
    const targetBookIds = parsed.targetBookIds.filter((value): value is string => typeof value === 'string' && value.length > 0);
    if (targetBookIds.length === 0) return null;
    return {
      entryId: parsed.entryId,
      targetBookIds,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeImportEnrichmentActiveRetry(retry: ImportEnrichmentActiveRetry | null) {
  try {
    if (!retry) {
      localStorage.removeItem(IMPORT_ENRICHMENT_ACTIVE_RETRY_KEY);
      return;
    }
    localStorage.setItem(IMPORT_ENRICHMENT_ACTIVE_RETRY_KEY, JSON.stringify(retry));
  } catch {
    // Recovery metadata is best-effort; the enrichment queue itself remains durable.
  }
}

export function writeImportEnrichmentRetryProgress(progress: ImportEnrichmentRetryProgress | null) {
  try {
    if (!progress) {
      localStorage.removeItem(IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY);
      writeImportEnrichmentActiveRetry(null);
      return;
    }

    const normalized = normalizeRetryProgress(progress);
    localStorage.setItem(IMPORT_ENRICHMENT_RETRY_PROGRESS_KEY, JSON.stringify(normalized));
    if (normalized.status === 'complete' || normalized.status === 'error') {
      writeImportEnrichmentActiveRetry(null);
    }
  } catch {
    // Foreground progress is convenience state only.
  }
}

/**
 * Rebuilds the retry queue from import history and returns the exact book IDs
 * requested by the user. Books whose active edition has been manually edited
 * are intentionally excluded: user-authored edition data always wins over
 * automatic metadata repair.
 */
export function retryImportHistoryItems(entry: ImportHistoryEntry, targetBookIds?: string[]): string[] {
  if (targetBookIds?.length) {
    const requestedIds = [...new Set(targetBookIds.filter(Boolean))];
    if (requestedIds.length > 0) {
      writeImportEnrichmentActiveRetry({
        entryId: entry.id,
        targetBookIds: requestedIds,
        startedAt: new Date().toISOString(),
      });
    }
    return requestedIds;
  }

  const existing = readImportEnrichmentQueue();
  const byBookId = new Map(existing.map((item) => [item.targetBookId, item]));
  const currentBooksById = new Map(readCurrentLibrary().map((book) => [book.id, book]));
  const requestedIds: string[] = [];

  (Array.isArray(entry.items) ? entry.items : []).forEach((item) => {
    if (hasManualActiveEdition(currentBooksById.get(item.targetBookId))) {
      byBookId.delete(item.targetBookId);
      return;
    }

    byBookId.set(item.targetBookId, historyItemToQueueItem(item));
    requestedIds.push(item.targetBookId);
  });

  writeImportEnrichmentQueue([...byBookId.values()]);
  if (requestedIds.length > 0) {
    writeImportEnrichmentActiveRetry({
      entryId: entry.id,
      targetBookIds: requestedIds,
      startedAt: new Date().toISOString(),
    });
  }
  return requestedIds;
}
