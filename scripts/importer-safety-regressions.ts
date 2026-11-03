import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { ImportRecordItem, UserBookRecord } from '../src/types';
import { applyImportExtrasToNewBook, mergeImportIntoExistingBook } from '../src/features/import/safeReimportMerge';
import { recoverIncompleteLatestImport } from '../src/features/import/recoverPendingImportBooks';
import { mergeEnrichedImportedBook } from '../src/features/import/libraryEnrichment';

const book = {
  id: 'paperback-owned',
  work: { id: 'work-one', title: 'A Book', author: 'A Writer', genres: [], publicationYear: 2020 },
  editions: [{ id: 'edition-paperback', format: 'paperback', isbn: undefined, pageCount: undefined, coverUrl: undefined }],
  activeEditionId: 'edition-paperback',
  status: 'tbr',
  progressPages: 0, progressMinutes: 0, progressPercentage: 0,
  privateTags: ['VIP TBR'], collections: [],
  rating: undefined, review: undefined, dateFinished: undefined,
} as unknown as UserBookRecord;
const incoming = {
  id: 'import-0-a-book',
  title: 'A Book', author: 'A Writer', isbn: '9781234567897',
  format: 'hardcover', status: 'finished', dateRead: '2026-10-01',
  dateAdded: '2026-10-01', coverGradient: 'from-black to-white',
  rating: 5, review: 'Old imported review', pageCount: 900,
  coverUrl: 'https://example.com/wrong-edition.jpg',
  sourceCollections: ['Favorites'], sourceShelves: ['Finished'],
} as ImportRecordItem;

const protectedBook = mergeImportIntoExistingBook(book, incoming);
assert.equal(protectedBook.status, 'tbr', 'Reimport must preserve a reader-reverted status.');
assert.equal(protectedBook.rating, undefined, 'Reimport must not refill a cleared rating.');
assert.equal(protectedBook.review, undefined, 'Reimport must not refill a cleared review.');
assert.deepEqual(protectedBook.collections, [], 'Reimport must not restore a removed Collection membership.');
assert.equal(protectedBook.dateFinished, undefined, 'Reimport must not restore a cleared finish date.');
assert.deepEqual(protectedBook.privateTags, ['VIP TBR'], 'Reimport must preserve reader tags.');
assert.equal(protectedBook.editions[0].isbn, undefined, 'Hardcover ISBN must not overwrite paperback edition.');
assert.equal(protectedBook.editions[0].pageCount, undefined, 'Hardcover pages must not overwrite paperback edition.');
assert.equal(protectedBook.editions[0].coverUrl, undefined, 'Hardcover cover must not overwrite paperback edition.');

const initialBook = mergeImportIntoExistingBook(book, { ...incoming, format: 'paperback' }, true);
assert.equal(initialBook.rating, 5, 'Initial imported record must still receive its source rating.');
assert.equal(initialBook.status, 'finished', 'Initial imported record must still receive its source reading status.');
assert.equal(initialBook.dateFinished, '2026-10-01', 'Initial imported record must receive its source finished date.');
assert.ok(initialBook.collections.includes('Favorites'), 'Initial import should preserve source collections.');
assert.equal(initialBook.editions[0].pageCount, 900, 'Initial import can enrich its own edition.');

const newWithExtras = applyImportExtrasToNewBook(initialBook, {
  ...incoming, tags: ['VIP TBR', 'vip tbr'], sourceShelves: ['My Shelf'],
});
assert.ok(newWithExtras.privateTags.includes('VIP TBR'), 'New imports preserve source tags.');
assert.ok(newWithExtras.privateTags.includes('My Shelf'), 'New imports preserve source shelves.');
assert.equal(newWithExtras.privateTags.filter((tag) => tag.toLowerCase() === 'vip tbr').length, 1,
  'Canonical tag identity prevents import casing duplicates.');

const catalogEnrichment = mergeEnrichedImportedBook(book, {
  ...book,
  dateStarted: '2026-09-01',
  dateFinished: '2026-10-01',
  importFinishedDateProvided: true,
  editions: [{ ...book.editions[0], format: 'hardcover', isbn: '9781234567897', pageCount: 900 }],
});
assert.equal(catalogEnrichment.dateStarted, undefined, 'Catalog enrichment must not restore a cleared start date.');
assert.equal(catalogEnrichment.dateFinished, undefined, 'Catalog enrichment must not restore a cleared finish date.');
assert.equal(catalogEnrichment.editions[0].isbn, undefined, 'Catalog enrichment must not cross edition formats.');
assert.equal(catalogEnrichment.editions[0].pageCount, undefined, 'Catalog pages must not cross edition formats.');

assert.equal(recoverIncompleteLatestImport(), 0, 'Retired recovery must never modify library data.');
const boundary = fs.readFileSync('src/features/sync/CloudDataRefreshBoundary.tsx', 'utf8');
assert.doesNotMatch(boundary, /\brecoverIncompleteLatestImport\s*\(/, 'Cloud refresh must not recover imported books.');
assert.doesNotMatch(boundary, /\breconcileRepeatedImportHistory\s*\(/, 'Cloud refresh must not collapse import history.');

console.log('Inkbound importer safety regressions passed.');
