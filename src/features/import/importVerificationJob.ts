import type { ImportRecordItem, UserBookRecord } from '../../types';
import { getRuntimeStorage } from '../../platform/runtimeStorage';
import { replaceCanonicalLibrary } from '../library/libraryMutations';
import { notifyCloudDataUpdated } from '../sync/cloudSyncEvents';
import { SYNC_STORAGE_KEYS } from '../sync/storageKeys';
import { appendCompletedImportAudit, beginImportAudit, failImportAudit } from './importHistory';
import { findExistingImportMatch, mergeImportIntoExistingBook, restoreManualSeriesOverridesFromImport } from './safeReimportMerge';

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

const emptySnapshot = (): ImportVerificationJobSnapshot => ({ status: 'idle', completed: 0, total: 0, importedCount: 0, matchedCount: 0, metadataPendingCount: 0, duplicates: [], unmatched: [] });

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
    if (parsed.status === 'running') return { ...emptySnapshot(), status: 'error', error: 'The previous import was interrupted before the library write finished. Upload the export again; existing books can be safely enriched without creating extra copies.' };
    return { ...emptySnapshot(), ...parsed, matchedCount: parsed.matchedCount ?? 0, metadataPendingCount: parsed.metadataPendingCount ?? 0, duplicates: Array.isArray(parsed.duplicates) ? parsed.duplicates : [], unmatched: [] };
  } catch { return emptySnapshot(); }
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
  } catch { return []; }
}

function emit(next: ImportVerificationJobSnapshot) {
  snapshot = next;
  persistSnapshot(snapshot);
  listeners.forEach((listener) => listener(snapshot));
}

function warnBeforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ''; }

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
  } catch { return fallback; }
}

function mergeExistingRecords(items: ImportRecordItem[], library: UserBookRecord[]): { library: UserBookRecord[]; merged: ImportRecordItem[]; unchanged: ImportRecordItem[]; remaining: ImportRecordItem[] } {
  let nextLibrary = library.map((book) => ({ ...book }));
  const merged: ImportRecordItem[] = [];
  const unchanged: ImportRecordItem[] = [];
  const remaining: ImportRecordItem[] = [];
  for (const item of items) {
    const requestedMatch = item.matchedBookId ? nextLibrary.find((book) => book.id === item.matchedBookId) : undefined;
    const match = requestedMatch ?? findExistingImportMatch(item, nextLibrary);
    if (!match || item.duplicateAction !== 'merge') { remaining.push(item); continue; }
    const updated = mergeImportIntoExistingBook(match, item);
    const outcomeItem = { ...item, matchedBookId: match.id, duplicateAction: 'merge' as const };
    if (JSON.stringify(updated) === JSON.stringify(match)) {
      unchanged.push(outcomeItem);
      continue;
    }
    nextLibrary = nextLibrary.map((book) => book.id === match.id ? updated : book);
    merged.push(outcomeItem);
  }
  return { library: nextLibrary, merged, unchanged, remaining };
}

function applySourceFieldsToBooks(items: ImportRecordItem[], library: UserBookRecord[]): { library: UserBookRecord[]; matched: number } {
  let nextLibrary = library;
  let matched = 0;
  for (const item of items) {
    const match = findExistingImportMatch(item, nextLibrary);
    if (!match) continue;
    const updated = mergeImportIntoExistingBook(match, { ...item, matchedBookId: match.id, duplicateAction: 'merge' }, true);
    nextLibrary = nextLibrary.map((book) => book.id === match.id ? updated : book);
    matched += 1;
  }
  return { library: nextLibrary, matched };
}

async function applySourceFieldsToNewBooks(items: ImportRecordItem[], fallbackLibrary: UserBookRecord[]): Promise<UserBookRecord[]> {
  if (items.length === 0) return fallbackLibrary;
  let latestLibrary = fallbackLibrary;
  let bestResult = { library: fallbackLibrary, matched: 0 };

  for (let attempt = 0; attempt < 10; attempt += 1) {
    latestLibrary = readCurrentBooks(latestLibrary);
    const result = applySourceFieldsToBooks(items, latestLibrary);
    if (result.matched > bestResult.matched) bestResult = result;
    if (result.matched === items.length) break;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
  }

  if (bestResult.matched > 0) {
    // Retry results may be older than reader edits made during the wait.
    // Reapply enrichment to the latest canonical library before committing.
    const latest = readCurrentBooks(bestResult.library);
    const refreshed = applySourceFieldsToBooks(items, latest);
    if (!replaceCanonicalLibrary(refreshed.library)) {
      throw new Error('Import metadata could not be saved; completion was not confirmed.');
    }
    return refreshed.library;
  }

  return latestLibrary;
}

/**
 * New rows are written by the normal App importer. Existing rows explicitly
 * marked as safe updates are additive: they may fill blanks and merge list data,
 * but never replace reader-owned dates, progress, manual covers, Collections,
 * or manual series work. Exported manual series corrections are restored only
 * when the destination book does not already have a manual series assignment.
 */
export function startImportVerificationJob(
  items: ImportRecordItem[],
  preDetectedDuplicates: ImportRecordItem[],
  executeImport: ImportExecutor,
  librarySnapshot?: UserBookRecord[],
  sourceName?: string,
): Promise<void> {
  if (activePromise) return activePromise;
  const normalizedItems = items.map(normalizeImportRecord);
  const normalizedPreDetectedDuplicates = preDetectedDuplicates.map(normalizeImportRecord);
  const sessionId = `import-session-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  emit({ status: 'running', completed: 0, total: normalizedItems.length, importedCount: 0, matchedCount: 0, metadataPendingCount: 0, duplicates: normalizedPreDetectedDuplicates, unmatched: [] });
  window.addEventListener('beforeunload', warnBeforeUnload);

  activePromise = (async () => {
    try {
      // A persisted session is required before any book can be changed.
      beginImportAudit(sessionId, normalizedItems, normalizedPreDetectedDuplicates, sourceName);
      const startingLibrary = librarySnapshot ?? [];
      const mergeResult = mergeExistingRecords(normalizedItems, startingLibrary);
      let workingLibrary = mergeResult.library;
      if (mergeResult.merged.length > 0) {
        if (!replaceCanonicalLibrary(workingLibrary)) {
          throw new Error('Imported book updates could not be saved.');
        }
        // Reimport must not recreate a manual series membership the reader removed.
        notifyCloudDataUpdated([SYNC_STORAGE_KEYS.books]);
      }

      const executionResult = mergeResult.remaining.length > 0 ? await executeImport(mergeResult.remaining) : [];
      const importedRecords = Array.isArray(executionResult) ? executionResult.map(normalizeImportRecord) : mergeResult.remaining;
      const importedIds = new Set(importedRecords.map((record) => record.id));
      const writeRejected = mergeResult.remaining.filter((record) => !importedIds.has(record.id));
      // A write failure is not a duplicate. Do not claim completion or append
      // an inaccurate "skipped" audit when the library write was rejected.
      if (writeRejected.length > 0) {
        throw new Error(`Import could not persist ${writeRejected.length} book(s). Previously saved books were preserved; no complete import was recorded.`);
      }

      workingLibrary = await applySourceFieldsToNewBooks(importedRecords, workingLibrary);
      if (importedRecords.length > 0) restoreManualSeriesOverridesFromImport(importedRecords, workingLibrary);
      persistMetadataPending(importedRecords);
      const duplicateMap = new Map(normalizedPreDetectedDuplicates.map((record) => [record.id, record]));
      appendCompletedImportAudit({
        submitted: normalizedItems,
        added: importedRecords,
        enriched: mergeResult.merged,
        unchanged: mergeResult.unchanged,
        skipped: [...duplicateMap.values()],
        sourceName,
        sessionId,
      });
      emit({ status: 'complete', completed: normalizedItems.length, total: normalizedItems.length, importedCount: importedRecords.length, matchedCount: mergeResult.merged.length + mergeResult.unchanged.length, metadataPendingCount: importedRecords.length, duplicates: [...duplicateMap.values()], unmatched: [] });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The import could not be completed. Previously saved books remain intact.';
      try { failImportAudit(sessionId, message); }
      catch (historyError) {
        console.error('[Inkbound importer] Import failure could not be recorded.', historyError);
      }
      emit({ ...snapshot, status: 'error', error: message });
    } finally {
      activePromise = null;
      window.removeEventListener('beforeunload', warnBeforeUnload);
    }
  })();

  return activePromise;
}
