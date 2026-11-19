import assert from 'node:assert/strict';
import { detectiveCandidatesAreSameWork, mergeDetectiveCandidates, type DetectiveMergeCandidate } from '../src/features/series/seriesDetectiveMerge';

const candidate = (title: string, provider: DetectiveMergeCandidate['provider']): DetectiveMergeCandidate => ({
  work: { key: provider + ':' + title, title, authors: ['Example Author'], genres: [], editions: [] },
  edition: { source: provider, externalEditionId: provider + ':' + title, title, authors: ['Example Author'], genres: [], publicationYear: 2020, isbn13: '9781234567897', format: 'paperback', specialFeatures: [] },
  seriesName: 'Example Series', position: null, provider, seriesStructured: true,
});
const first = candidate('First Installment', 'open-library');
const second = candidate('Second Installment', 'hardcover');
assert.equal(detectiveCandidatesAreSameWork(first, second), false,
  'Shared ISBN and series must not collapse different titles');
assert.equal(mergeDetectiveCandidates([first, second]).length, 2,
  'Distinct installments must remain separate in the roster');
const matching = candidate('First Installment', 'hardcover');
assert.equal(detectiveCandidatesAreSameWork(first, matching), true,
  'Identical title and author may still corroborate across providers');
console.log('Series Detective merge identity regressions passed.');
