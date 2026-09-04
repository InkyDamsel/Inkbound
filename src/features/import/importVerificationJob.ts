import type { ImportRecordItem, UserBookRecord } from '../../types';

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
  try {
    localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
  } catch {
    // Import Center state is best-effort only.
  }
}

function readStoredSnapshot(): ImportVerificationJobSnapshot {
  try {
    localStorage.removeItem(LEGACY_SNAPSHOT_STORAGE_KEY);
    const stored = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!stored) return emptySnapshot();
    const parsed = JSON.parse(stored) as Partial<ImportVerificationJobSnapshot>;

    if (parsed.status === 'complete') {
      clearCompletedUiState();
      return emptySnapshot();
    }

    if (parsed.status === 'running') {
      return {
        ...emptySnapshot(),
        status: 'error',
        error: 'The previous import was interrupted before the library write finished. Upload the export again; books that were already added will be detected as duplicates and skipped.',
      };
    }

    return {
      ...emptySnapshot(),
      ...parsed,
      matchedCount: parsed.matchedCount ?? 0,
      metadataPendingCount: parsed.metadataPendingCount ?? 0,
      duplicates: Array.isArray(parsed.duplicates) ? parsed.duplicates : [],
      unmatched: [],
    };
  } catch {
    return emptySnapshot();
  }
}

let snapshot: ImportVerificationJobSnapshot = readStoredSnapshot();
let activePromise: Promise<void> | null = null;
const listeners = new Set<Listener>();

function persistSnapshot(next: ImportVerificationJobSnapshot) {
  try {
    localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Persistence is best-effort. The active in-memory job should continue.
  }
}

function persistMetadataPending(items: ImportRecordItem[]) {
  try {
    if (items.length === 0) {
      localStorage.removeItem(METADATA_PENDING_STORAGE_KEY);
      return;
    }
    localStorage.setItem(METADATA_PENDING_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // The normal enrichment queue remains the source of truth for retries.
  }
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
  if (snapshot.status === 'complete' && !activePromise) {
    snapshot = emptySnapshot();
    clearCompletedUiState();
  }
  return snapshot;
}

export function subscribeToImportVerification(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => {
    listeners.delete(listener);
  };
}

export function resetImportVerificationJob() {
  if (snapshot.status === 'running') return;
  snapshot = emptySnapshot();
  try {
    localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
    localStorage.removeItem(METADATA_PENDING_STORAGE_KEY);
  } catch {
    // Best-effort cleanup only.
  }
  listeners.forEach((listener) => listener(snapshot));
}

/**
 * Imports the user's source-of-truth records immediately.
 *
 * Optional cover/summary/edition enrichment is deliberately NOT performed here.
 * The App import executor creates fallback books and places accepted records on
 * the resumable enrichment queue, allowing very large libraries to finish the
 * actual import without waiting on thousands of external metadata requests.
 *
 * The legacy function name is retained so existing Import Center callers do not
 * need a coordinated migration.
 */
export function startImportVerificationJob(
  items: ImportRecordItem[],
  preDetectedDuplicates: ImportRecordItem[],
  executeImport: ImportExecutor,
  librarySnapshot?: UserBookRecord[],
): Promise<void> {
  if (activePromise) return activePromise;
  void librarySnapshot;

  const normalizedItems = items.map(normalizeImportRecord);
  const normalizedPreDetectedDuplicates = preDetectedDuplicates.map(normalizeImportRecord);

  emit({
    status: 'running',
    completed: 0,
    total: normalizedItems.length,
    importedCount: 0,
    matchedCount: 0,
    metadataPendingCount: 0,
    duplicates: normalizedPreDetectedDuplicates,
    unmatched: [],
  });

  window.addEventListener('beforeunload', warnBeforeUnload);

  activePromise = (async () => {
    try {
      // The export is the source of truth. Add accepted records first; metadata
      // enrichment happens later from the background queue created by App.tsx.
      const executionResult = normalizedItems.length > 0
        ? await executeImport(normalizedItems)
        : [];
      const importedRecords = Array.isArray(executionResult)
        ? executionResult.map(normalizeImportRecord)
        : normalizedItems;
      const importedIds = new Set(importedRecords.map((record) => record.id));
      const writeRejected = normalizedItems
        .filter((record) => !importedIds.has(record.id))
        .map((record) => ({ ...record, duplicateAction: 'skip' as const }));

      // Keep a best-effort missing-details list for the Import History download.
      // If this exceeds browser local-storage limits, the normal enrichment queue
      // remains authoritative and the import itself still succeeds.
      persistMetadataPending(importedRecords);

      const duplicateMap = new Map(normalizedPreDetectedDuplicates.map((record) => [record.id, record]));
      writeRejected.forEach((record) => duplicateMap.set(record.id, record));

      emit({
        status: 'complete',
        completed: normalizedItems.length,
        total: normalizedItems.length,
        importedCount: importedRecords.length,
        matchedCount: 0,
        metadataPendingCount: importedRecords.length,
        duplicates: [...duplicateMap.values()],
        unmatched: [],
      });
    } catch (error) {
      emit({
        ...snapshot,
        status: 'error',
        error: error instanceof Error
          ? error.message
          : 'The import could not be completed. Books already written to your library were left intact.',
      });
    } finally {
      activePromise = null;
      window.removeEventListener('beforeunload', warnBeforeUnload);
    }
  })();

  return activePromise;
}
