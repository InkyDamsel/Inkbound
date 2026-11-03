import assert from 'node:assert/strict';
import type { ImportRecordItem, UserBookRecord } from '../src/types';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
}});
const { appendCompletedImportAudit, beginImportAudit, failImportAudit, readImportHistory, writeImportHistory,
  ensureImportHistoryForExistingLibrary, IMPORT_HISTORY_STORAGE_KEY } = await import('../src/features/import/importHistory');
const { reconcileRepeatedImportHistory } = await import('../src/features/import/reconcileImportHistory');

const record = (id: string): ImportRecordItem => ({
  id, title: 'An Existing Book', author: 'Test Author', format: 'paperback',
  status: 'tbr', dateAdded: '2026-11-02', coverGradient: 'from-black to-white',
} as ImportRecordItem);

const row = record('row-1');
beginImportAudit('import-session-failure', [row], [], 'interrupted.csv');
assert.equal(readImportHistory()[0].status, 'running', 'Import must be recorded before mutation.');
failImportAudit('import-session-failure', 'Synthetic storage failure');
assert.equal(readImportHistory()[0].status, 'failed', 'Interrupted import must retain an audit record.');
assert.equal(readImportHistory()[0].outcomes?.[0]?.recordId, row.id, 'Failed history retains the attempted book.');
writeImportHistory([]);
beginImportAudit('import-session-success', [row], [], 'finished.csv');
appendCompletedImportAudit({
  sessionId: 'import-session-success',
  submitted: [row], added: [row], enriched: [], skipped: [], sourceName: 'finished.csv',
});
assert.equal(readImportHistory().length, 1, 'Completing a started import must update its event, not append a second.');
assert.equal(readImportHistory()[0].status, 'completed');
writeImportHistory([]);
// Two completed imports with ZERO new books are separate sessions forever.
appendCompletedImportAudit({ submitted: [row], added: [], enriched: [], unchanged: [row], skipped: [], sourceName: 'one.csv' });
appendCompletedImportAudit({ submitted: [row], added: [], enriched: [], unchanged: [row], skipped: [], sourceName: 'two.csv' });
const initial = readImportHistory();
assert.equal(initial.length, 2, 'A second zero-new import must never replace the first.');
assert.equal(reconcileRepeatedImportHistory([]).length, 2, 'Reconciliation must not collapse independent sessions.');
assert.equal(readImportHistory().length, 2, 'A read must not rewrite/delete stored sessions.');
assert.deepEqual(new Set(initial.map((entry) => entry.sourceName)), new Set(['one.csv', 'two.csv']));
assert.equal(initial[0].unchangedCount, 1);
assert.equal(initial[0].totalCount, 1, 'A one-row merge-only import must not double count.');
assert.equal(initial[0].outcomes?.[0]?.outcome, 'unchanged');
assert.equal(initial[0].outcomes?.[0]?.targetBookId, undefined);
appendCompletedImportAudit({
  submitted: [row], added: [], enriched: [],
  unchanged: [{ ...row, matchedBookId: 'unchanged-existing-book' }],
  skipped: [], sourceName: 'unchanged-with-match.csv',
});
assert.equal(readImportHistory()[0].outcomes?.[0]?.targetBookId, 'unchanged-existing-book',
  'An unchanged merge must retain the canonical matched ID, not the unresolved CSV row.');


appendCompletedImportAudit({
  submitted: [record('added'), record('updated')],
  added: [record('added')],
  enriched: [{ ...record('updated'), matchedBookId: 'existing-book-id' }],
  skipped: [record('skipped')],
  sourceName: 'three.csv',
});
const third = readImportHistory()[0];
assert.equal(third.totalCount, 3);
assert.equal(third.importedCount, 1);
assert.equal(third.enrichedCount, 1);
assert.equal(third.duplicateCount, 1);
assert.equal(third.outcomes?.length, 3);
assert.deepEqual(third.outcomes?.map((item) => item.outcome), ['added', 'updated', 'skipped']);
assert.equal(third.outcomes?.[1]?.targetBookId, 'existing-book-id');
assert.equal(third.items.length, 1, 'Enrichment retry items must continue containing only newly added books.');

// Synthesized legacy history is display-only, never a real stored event.
writeImportHistory([]);
const legacy = { id: 'book-import-legacy', sourceOfImport: 'Goodreads',
  dateAdded: '2025-01-01', status: 'tbr', privateTags: ['imported'],
  work: { title: 'Legacy Book', author: 'An Author' },
  editions: [{ id: 'edition-legacy', format: 'paperback' }], activeEditionId: 'edition-legacy',
} as unknown as UserBookRecord;
assert.equal(ensureImportHistoryForExistingLibrary([legacy])[0]?.id, 'import-history-existing-library');
assert.equal(values.has(IMPORT_HISTORY_STORAGE_KEY), false, 'Synthetic display entries must not be persisted.');
// A deliberately removed imported book must not be silently resurrected.
const { findPreviouslyRemovedImportRows } = await import('../src/features/import/deletedImportGuard');
const deletedRow = { ...record('removed'), isbn: '9780316584579' };
const deletedHistory = [{
  id: 'old-import', createdAt: '2026-10-01T00:00:00Z', sourceName: 'old.csv',
  importedCount: 1, duplicateCount: 0,
  items: [{ recordId: deletedRow.id, targetBookId: 'book-import-removed', title: deletedRow.title,
    author: deletedRow.author, isbn: deletedRow.isbn, format: deletedRow.format,
    status: deletedRow.status, dateAdded: deletedRow.dateAdded, coverGradient: deletedRow.coverGradient }],
}];
assert.equal(findPreviouslyRemovedImportRows([deletedRow], [], deletedHistory).length, 1,
  'Reimport must not resurrect an imported book missing from the canonical library.');
assert.equal(findPreviouslyRemovedImportRows([deletedRow], [{ id: 'book-import-removed' } as UserBookRecord], deletedHistory).length, 0,
  'A book still owned is not a previously removed record.');
assert.equal(findPreviouslyRemovedImportRows([{ ...deletedRow, isbn: '9780316584586' }], [], deletedHistory).length, 0,
  'A different known ISBN must remain a distinct edition identity.');

// Exercise the actual import job's explicit writer result contract. A late
// duplicate is SKIPPED; a failed canonical write is FAILED, never equivalent.
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => true,
  setTimeout,
}});
const { startImportVerificationJob } = await import('../src/features/import/importVerificationJob');
writeImportHistory([]);
await startImportVerificationJob([], [row], async () => {
  throw new Error('Skip-only imports must not call the writer.');
}, []);
assert.equal(readImportHistory()[0]?.status, 'completed');
assert.equal(readImportHistory()[0]?.duplicateCount, 1);
assert.equal(readImportHistory()[0]?.totalCount, 1);
assert.equal(readImportHistory()[0]?.outcomes?.[0]?.outcome, 'skipped');

writeImportHistory([]);
await startImportVerificationJob([row], [], async () => ({
  added: [], skipped: [row], failed: [],
}), []);
const skippedAudit = readImportHistory()[0];
assert.equal(skippedAudit.status, 'completed');
assert.equal(skippedAudit.duplicateCount, 1);
assert.equal(skippedAudit.outcomes?.[0]?.outcome, 'skipped');

writeImportHistory([]);
await startImportVerificationJob([row], [], async () => ({
  added: [], skipped: [], failed: [row],
}), []);
const failedAudit = readImportHistory()[0];
assert.equal(failedAudit.status, 'failed', 'Rejected writes cannot be counted as skipped duplicates.');
assert.equal(failedAudit.importedCount, 0);

const { mergeImportHistoryEvents } = await import('../src/features/import/importHistoryReconciliation');
const runningEvent = { ...failedAudit, id: 'session-shared', status: 'running' as const, outcomes: [] };
const completeEvent = { ...runningEvent, status: 'completed' as const,
  outcomes: [{ recordId: 'row-1', title: 'An Existing Book', author: 'Test Author', outcome: 'added' as const }] };
const crossDevice = mergeImportHistoryEvents([runningEvent], [completeEvent]);
assert.equal(crossDevice[0].status, 'completed', 'Stale local running state must not replace cloud completion.');
assert.equal(mergeImportHistoryEvents([], [completeEvent]).length, 1, 'New device must restore remote event.');
assert.equal(mergeImportHistoryEvents([runningEvent], []).length, 1, 'Remote absence never deletes local event.');

console.log('Inkbound importer history regressions passed.');
