import type { ImportRecordItem, UserBookRecord } from '../../types';
import { getRuntimeStorage, writeRuntimeJson } from '../../platform/runtimeStorage';
import { notifyCloudDataUpdated } from '../sync/cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from '../sync/storageKeys';
import { findExistingImportMatch, mergeImportIntoExistingBook } from './safeReimportMerge';

export type ImportVerificationJobStatus = 'idle' | 'running' | 'complete' | 'error';

export interface ImportVerificationJobSnapshot {
  status: ImportVerificationJobStatus;
  completed: number;
  total: number;
  importedCount: number;
  matchedCount: number;
  metadataPendingCount: number;
  duplicates: ImportRecordItem[];
  unmatched: ImportRecordItem[];
  error?: string;
}

type ImportExecutor = (items: ImportRecordItem[]) => Promise<ImportRecordItem[] | void> | ImportRecordItem[] | void;
type Listener = (snapshot: ImportVerificationJobSnapshot) => void;

const SNAPSHOT_STORAGE_KEY = 'inkbound_import_verification_result_v2';
const LEGACY_SNAPSHOT_STORAGE_KEY = 'inkbound_import_verification_result_v1';
const METADATA_PENDING_STORAGE_KEY = 'inkbound_import_metadata_pending_v1';

const emptySnapshot = (): ImportVerificationJobSnapshot => ({
  status: 'idle',
  completed: 0,
  total: 0,
  importedCount: 0,
  matchedCount: 0,
  metadataPendingCount: 0,
  duplicates: [],
  unmatched: [],
});

function normalizeImportedIsbn(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const spreadsheetWrapped = trimmed.match(/^=\s*["']([^"']+)["']$/);
  const candidate = spreadsheetWrapped?.[1] ?? trimmed;
  const normalized = candidate.replace(/[^0-9X]/gi, '').toUpperCase();
  return normalized || undefined;
}

function normalizeImportRecord(record: ImportRecordItem): ImportRecordItem {
  return { ...record, isbn: normalizeImportedIsbn(record.isbn) };
}

function clearCompletedUiState() {
  try { localStorage.removeItem(SNAPSHOT_STORAGE_KEY); } catch { /* best effort */ }
}

function readStoredSnapshot(): ImportVerificationJobSnapshot {
  try {
    localStorage.removeItem(LEGACY_SNAPSHOT_STORAGE_KEY);
    const stored = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!stored) return emptySnapshot();
    const parsed = JSON.parse(stored) as Partial<ImportVerificationJobSnapshot>;
    if (parsed.status === 'complete') { clearCompletedUiState(); return emptySnapshot(); }
    if (parsed.status === 'running') {
      return { ...emptySnapshot(), status: 'error', error: 'The previous import was interrupted before the library write finished. Upload the export again; existing books can be safely enriched without creating extra copies.' };
    }
    return { ...emptySnapshot(), ...parsed, matchedCount: parsed.matchedCount ?? 0, metadataPendingCount: parsed.metadataPendingCount ?? 0, duplicates: Array.isArray(parsed.duplicates) ? parsed.duplicates : [], unmatched: [] };
  } catch {
    return emptySnapshot();
  }
}

let snapshot: ImportVerificationJobSnapshot = readStoredSnapshot();
let activePromise: Promise<void> | null = null;
const listeners = new Set<Listener>();

function persistSnapshot(next: ImportVerificationJobSnapshot) {
  try { localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(next)); } catch { /* best effort */ }
}

function persistMetadataPending(items: ImportRecordItem[]) {
  try {
    if (items.length === 0) { localStorage.removeItem(METADATA_PENDING_STORAGE_KEY); return; }
    localStorage.setItem(METADATA_PENDING_STORAGE_KEY, JSON.stringify(items));
  } catch { /* normal enrichment queue remains authoritative */ }
}

export function readImportMetadataPending(): ImportRecordItem[] {
  try {
    const stored = localStorage.getItem(METADATA_PENDING_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? (parsed as ImportRecordItem[]).map(normalizeImportRecord) : [];
  } catch {
    return [];
  }
}

function emit(next: ImportVerificationJobSnapshot) {
  snapshot = next;
  persistSnapshot(snapshot);
  listeners.forEach((listener) => listener(snapshot));
}

function warnBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = '';
}

export function getImportVerificationSnapshot(): ImportVerificationJobSnapshot {
  if (snapshot.status === 'complete' && !activePromise) { snapshot = emptySnapshot(); clearCompletedUiState(); }
  return snapshot;
}

export function subscribeToImportVerification(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => { listeners.delete(listener); };
}

export function resetImportVerificationJob() {
  if (snapshot.status === 'running') return;
  snapshot = emptySnapshot();
  try { localStorage.removeItem(SNAPSHOT_STORAGE_KEY); localStorage.removeItem(METADATA_PENDING_STORAGE_KEY); } catch { /* best effort */ }
  listeners.forEach((listener) => listener(snapshot));
}

function readCurrentBooks(fallback: UserBookRecord[]): UserBookRecord[] {
  try {
    const stored = getRuntimeStorage().getItem(SYNC_STORAGE_KEYS.books);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? parsed as UserBookRecord[] : fallback;
  } catch {
    return fallback;
  }
}

function mergeExistingRecords(items: ImportRecordItem[], library: UserBookRecord[]): {
  library: UserBookRecord[];
  merged: ImportRecordItem[];
  remaining: ImportRecordItem[];
} {
  let nextLibrary = library.map((book) => ({ ...book }));
  const merged: ImportRecordItem[] = [];
  const remaining: ImportRecordItem[] = [];

  for (const item of items) {
    const requestedMatch = item.matchedBookId ? nextLibrary.find((book) => book.id === item.matchedBookId) : undefined;
    const match = requestedMatch ?? findExistingImportMatch(item, nextLibrary);
    if (!match || item.duplicateAction !== 'merge') { remaining.push(item); continue; }
    const updated = mergeImportIntoExistingBook(match, item);
    nextLibrary = nextLibrary.map((book) => book.id === match.id ? updated : book);
    merged.push({ ...item, matchedBookId: match.id, duplicateAction: 'merge' });
  }

  return { library: nextLibrary, merged, remaining };
}

function applySourceFieldsToNewBooks(items: ImportRecordItem[], fallbackLibrary: UserBookRecord[]): UserBookRecord[] {
  let nextLibrary = readCurrentBooks(fallbackLibrary);
  let changed = false;
  for (const item of items) {
    const match = findExistingImportMatch(item, nextLibrary);
    if (!match) continue;
    const updated = mergeImportIntoExistingBook(match, { ...item, matchedBookId: match.id, duplicateAction: 'merge' });
    nextLibrary = nextLibrary.map((book) => book.id === match.id ? updated : book);
    changed = true;
  }
  if (changed) {
    writeRuntimeJson(SYNC_STORAGE_KEYS.books, nextLibrary);
    notifyCloudDataUpdated([SYNC_STORAGE_KEYS.books]);
  }
  return nextLibrary;
}

/**
 * New rows are written by the normal App importer. Existing rows explicitly
 * marked as safe updates are additive: they may fill blanks and merge list data,
 * but never replace reader-owned dates, progress, manual covers, Collections,
 * or manual series work.
 */
export function startImportVerificationJob(
  items: ImportRecordItem[],
  preDetectedDuplicates: ImportRecordItem[],
  executeImport: ImportExecutor,
  librarySnapshot?: UserBookRecord[],
): Promise<void> {
  if (activePromise) return activePromise;

  const normalizedItems = items.map(normalizeImportRecord);
  const normalizedPreDetectedDuplicates = preDetectedDuplicates.map(normalizeImportRecord);
  emit({ status: 'running', completed: 0, total: normalizedItems.length, importedCount: 0, matchedCount: 0, metadataPendingCount: 0, duplicates: normalizedPreDetectedDuplicates, unmatched: [] });
  window.addEventListener('beforeunload', warnBeforeUnload);

  activePromise = (async () => {
    try {
      const startingLibrary = librarySnapshot ?? [];
      const mergeResult = mergeExistingRecords(normalizedItems, startingLibrary);
      let workingLibrary = mergeResult.library;

      if (mergeResult.merged.length > 0) {
        writeRuntimeJson(SYNC_STORAGE_KEYS.books, workingLibrary);
        notifyCloudDataUpdated([SYNC_STORAGE_KEYS.books]);
      }

      const executionResult = mergeResult.remaining.length > 0 ? await executeImport(mergeResult.remaining) : [];
      const importedRecords = Array.isArray(executionResult) ? executionResult.map(normalizeImportRecord) : mergeResult.remaining;
      const importedIds = new Set(importedRecords.map((record) => record.id));
      const writeRejected = mergeResult.remaining.filter((record) => !importedIds.has(record.id)).map((record) => ({ ...record, duplicateAction: 'skip' as const }));

      // App creates the new records first. Re-run the same additive merge against
      // those just-created books so tags/shelves/mapped Collections from the
      // source file are not lost on first import either.
      if (importedRecords.length > 0) workingLibrary = applySourceFieldsToNewBooks(importedRecords, workingLibrary);

      persistMetadataPending(importedRecords);
      const duplicateMap = new Map(normalizedPreDetectedDuplicates.map((record) => [record.id, record]));
      writeRejected.forEach((record) => duplicateMap.set(record.id, record));

      emit({
        status: 'complete',
        completed: normalizedItems.length,
        total: normalizedItems.length,
        importedCount: importedRecords.length,
        matchedCount: mergeResult.merged.length,
        metadataPendingCount: importedRecords.length,
        duplicates: [...duplicateMap.values()],
        unmatched: [],
      });
    } catch (error) {
      emit({ ...snapshot, status: 'error', error: error instanceof Error ? error.message : 'The import could not be completed. Books already written to your library were left intact.' });
    } finally {
      activePromise = null;
      window.removeEventListener('beforeunload', warnBeforeUnload);
    }
  })();

  return activePromise;
}
