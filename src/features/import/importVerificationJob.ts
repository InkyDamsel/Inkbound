import type { ImportRecordItem, UserBookRecord } from '../../types';
import { verifyImportRecords } from './libraryEnrichment';

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

type ImportExecutor = (items: ImportRecordItem[]) => Promise<void> | void;
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
        error: 'The previous verification was interrupted when Inkbound closed or refreshed. Upload the export again to restart it.',
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
    return Array.isArray(parsed) ? (parsed as ImportRecordItem[]) : [];
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

export function startImportVerificationJob(
  items: ImportRecordItem[],
  preDetectedDuplicates: ImportRecordItem[],
  executeImport: ImportExecutor,
  librarySnapshot?: UserBookRecord[],
): Promise<void> {
  if (activePromise) return activePromise;

  emit({
    status: 'running',
    completed: 0,
    total: items.length,
    importedCount: 0,
    matchedCount: 0,
    metadataPendingCount: 0,
    duplicates: preDetectedDuplicates,
    unmatched: [],
  });

  window.addEventListener('beforeunload', warnBeforeUnload);

  activePromise = (async () => {
    try {
      const verification = await verifyImportRecords(items, (completed, total) => {
        emit({
          ...snapshot,
          status: 'running',
          completed,
          total,
        });
      }, librarySnapshot);

      const verifiedRecords = verification.verified.map((record) => ({
        ...record,
        importMetadataVerified: true,
      }));
      const unmatchedRecords = verification.unmatched.map((record) => ({
        ...record,
        importMetadataVerified: false,
      }));
      const recordsToImport = [...verifiedRecords, ...unmatchedRecords];

      if (recordsToImport.length > 0) {
        await executeImport(recordsToImport);
      }

      persistMetadataPending(unmatchedRecords);

      const duplicateMap = new Map(preDetectedDuplicates.map((record) => [record.id, record]));
      verification.duplicates.forEach((record) => duplicateMap.set(record.id, record));

      emit({
        status: 'complete',
        completed: items.length,
        total: items.length,
        importedCount: recordsToImport.length,
        matchedCount: verifiedRecords.length,
        metadataPendingCount: unmatchedRecords.length,
        duplicates: [...duplicateMap.values()],
        unmatched: [],
      });
    } catch (error) {
      emit({
        ...snapshot,
        status: 'error',
        error: error instanceof Error
          ? error.message
          : 'The import could not be completed. Your library was not changed.',
      });
    } finally {
      activePromise = null;
      window.removeEventListener('beforeunload', warnBeforeUnload);
    }
  })();

  return activePromise;
}
