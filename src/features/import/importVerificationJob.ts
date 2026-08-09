import type { ImportRecordItem } from '../../types';
import { verifyImportRecords } from './libraryEnrichment';

export type ImportVerificationJobStatus = 'idle' | 'running' | 'complete' | 'error';

export interface ImportVerificationJobSnapshot {
  status: ImportVerificationJobStatus;
  completed: number;
  total: number;
  importedCount: number;
  duplicates: ImportRecordItem[];
  unmatched: ImportRecordItem[];
  error?: string;
}

type ImportExecutor = (items: ImportRecordItem[]) => Promise<void> | void;
type Listener = (snapshot: ImportVerificationJobSnapshot) => void;

let snapshot: ImportVerificationJobSnapshot = {
  status: 'idle',
  completed: 0,
  total: 0,
  importedCount: 0,
  duplicates: [],
  unmatched: [],
};

let activePromise: Promise<void> | null = null;
const listeners = new Set<Listener>();

function emit(next: ImportVerificationJobSnapshot) {
  snapshot = next;
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
  return () => listeners.delete(listener);
}

export function resetImportVerificationJob() {
  if (snapshot.status === 'running') return;
  emit({
    status: 'idle',
    completed: 0,
    total: 0,
    importedCount: 0,
    duplicates: [],
    unmatched: [],
  });
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

      if (verification.verified.length > 0) {
        await executeImport(verification.verified);
      }

      const duplicateMap = new Map(preDetectedDuplicates.map((record) => [record.id, record]));
      verification.duplicates.forEach((record) => duplicateMap.set(record.id, record));

      emit({
        status: 'complete',
        completed: items.length,
        total: items.length,
        importedCount: verification.verified.length,
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
