import assert from 'node:assert/strict';
import type { ImportRecordItem, UserBookRecord } from '../src/types';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
}});
const { appendCompletedImportAudit, readImportHistory, writeImportHistory,
  ensureImportHistoryForExistingLibrary, IMPORT_HISTORY_STORAGE_KEY } = await import('../src/features/import/importHistory');
const { reconcileRepeatedImportHistory } = await import('../src/features/import/reconcileImportHistory');

const record = (id: string): ImportRecordItem => ({
  id, title: 'An Existing Book', author: 'Test Author', format: 'paperback',
  status: 'tbr', dateAdded: '2026-11-02', coverGradient: 'from-black to-white',
} as ImportRecordItem);

const row = record('row-1');
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
console.log('Inkbound importer history regressions passed.');
