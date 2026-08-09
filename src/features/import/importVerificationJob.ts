import type { ImportRecordItem } from '../../types';
import { verifyImportRecords } from './libraryEnrichment';

export type ImportVerificationJobStatus = 'idle' | 'running' | 'complete' | 'error';

export interface ImportVerificationJobSnapshot {
  status: ImportVerificationJobStatus;
  completed: number;
  total: number;
  importedCount: number;
  matchedCount: number;
  duplicates: ImportRecordItem[];
  unmatched: ImportRecordItem[];
  error?: string;
}

type ImportExecutor = (items: ImportRecordItem[]) => Promise<void> | void;
type Listener = (snapshot: ImportVerificationJobSnapshot) => void;

const SNAPSHOT_STORAGE_KEY = 'inkbound_import_verification_result_v1';

const emptySnapshot = (): ImportVerificationJobSnapshot => ({
  status: 'idle',
  completed: 0,
  total: 0,
  importedCount: 0,
  matchedCount: 0,
  duplicates: [],
  unmatched: [],
});

function readStoredSnapshot(): ImportVerificationJobSnapshot {
  try {
    const stored = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!stored) return emptySnapshot();
    const parsed = JSON.parse(stored) as Partial<ImportVerificationJobSnapshot>;

    // A browser refresh terminates in-memory verification. Keep completed results,
    // but never pretend an interrupted job is still running after reload.
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
      matchedCount: parsed.matchedCount ?? parsed.importedCount ?? 0,
      duplicates: Array.isArray(parsed.duplicates) ? parsed.duplicates : [],
      unmatched: Array.isArray(parsed.unmatched) ? parsed.unmatched : [],
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
  } catch {
    // Best-effort cleanup only.
  }
  listeners.forEach((listener) => listener(snapshot));
}

export function startImportVerificationJob(
  items: ImportRecordItem[],
  preDetectedDuplicates: ImportRecordItem[],
  executeImport: ImportExecutor,
): Promise<void> {
  if (activePromise) return activePromise;

  emit({
    status: 'running',
    completed: 0,
    total: items.length,
    importedCount: 0,
    matchedCount: 0,
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
      });

      // The export file is the source of truth for the user's own library fields.
      // Verification only decides whether external metadata is trusted. Books that
      // cannot be matched still enter Inkbound with their imported title/author,
      // shelf, rating, dates, review, ISBN, and placeholder metadata. The normal
      // enrichment queue can retry covers/summaries later without blocking import.
      const recordsToImport = [...verification.verified, ...verification.unmatched];
      if (recordsToImport.length > 0) {
        await executeImport(recordsToImport);
      }

      const duplicateMap = new Map(preDetectedDuplicates.map((record) => [record.id, record]));
      verification.duplicates.forEach((record) => duplicateMap.set(record.id, record));

      emit({
        status: 'complete',
        completed: items.length,
        total: items.length,
        importedCount: recordsToImport.length,
        matchedCount: verification.verified.length,
        duplicates: [...duplicateMap.values()],
        unmatched: verification.unmatched,
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
